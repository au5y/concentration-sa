/** Heart-rate straps: GATT parsing, storage on the server clock, exports and per-phase summary. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStrapPeaks, hrByPhase, parseHrMeasurement } from '../src/lib/hr';

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('parseHrMeasurement', () => {
	it('reads 8-bit HR without contact support or RR', () => {
		expect(parseHrMeasurement(dv([0x00, 72]))).toEqual({ bpm: 72, rr: [], contact: null });
	});
	it('reads contact status and RR intervals (1/1024 s -> ms), like a Polar H10', () => {
		// flags: RR present (0x10) + contact supported (0x04) + detected (0x02); RR 1024 and 819
		expect(parseHrMeasurement(dv([0x16, 60, 0x00, 0x04, 0x33, 0x03]))).toEqual({ bpm: 60, rr: [1000, 800], contact: true });
	});
	it('reads 16-bit HR, skips energy expended, flags lost contact', () => {
		// flags: 16-bit (0x01) + contact supported, not detected (0x04) + energy (0x08)
		expect(parseHrMeasurement(dv([0x0d, 0x2c, 0x01, 0x10, 0x00]))).toEqual({ bpm: 300, rr: [], contact: false });
	});
});

describe('hrByPhase', () => {
	it('averages readings inside each phase and ignores no-contact readings', () => {
		const phases = [
			{ pid: 'P01', phase: 'interval1', started_at: 1000, ended_at: 2000 },
			{ pid: 'P01', phase: 'board_a', started_at: 2000, ended_at: null }
		];
		const samples = [
			{ pid: 'P01', ts: 1100, bpm: 100, contact: 1 },
			{ pid: 'P01', ts: 1500, bpm: 140, contact: null },
			{ pid: 'P01', ts: 1600, bpm: 200, contact: 0 },
			{ pid: 'P01', ts: 2500, bpm: 90, contact: 1 },
			{ pid: null, ts: 2500, bpm: 50, contact: 1 }
		];
		const r = hrByPhase(samples, phases).P01;
		expect([r.hr_mean_interval1, r.hr_peak_interval1, r.hr_n_interval1]).toEqual([120, 140, 2]);
		expect([r.hr_mean_board_a, r.hr_n_board_a]).toEqual([90, 1]);
		expect(r.hr_mean_sa).toBeNull();
	});
});

describe('stored readings', () => {
	let dir: string;
	let hr: typeof import('../src/lib/server/hr');
	let admin: typeof import('../src/lib/server/admin');
	let session: typeof import('../src/lib/server/session');
	let db: typeof import('../src/lib/server/db');
	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-hr-'));
		process.env.DATA_DIR = dir;
		fs.writeFileSync(path.join(dir, 'schedule.csv'), 'pid,condition,board_a_theme,board_b_theme,seed\nP01,elevated_hr,mit,transport,1\n');
		hr = await import('../src/lib/server/hr');
		admin = await import('../src/lib/server/admin');
		session = await import('../src/lib/server/session');
		db = await import('../src/lib/server/db');
	});
	afterAll(() => {
		db.getDb().close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('moves readings onto the server clock, ignores re-sends, and fills the summary', () => {
		session.openSession('P01');
		const started = (db.getDb().prepare("SELECT started_at FROM phases WHERE pid = 'P01'").get() as { started_at: number }).started_at;
		// facilitator computer runs 5 s slow
		const skew = -5000;
		const now = Date.now();
		const samples = [0, 1, 2].map((i) => ({ strap: 'dev-1', strap_name: 'Polar H10 ABC', pid: 'P01', ts: now + skew + i * 1000, bpm: 80 + i, rr: [750, 740], contact: true }));
		expect(hr.recordHr(samples, now + skew)).toEqual({ stored: 3 });
		expect(hr.recordHr(samples, now + skew)).toEqual({ stored: 0 });
		const rows = db.getDb().prepare('SELECT ts, bpm, rr_ms FROM hr_samples ORDER BY ts').all() as { ts: number; bpm: number; rr_ms: string }[];
		expect(Math.abs(rows[0].ts - now)).toBeLessThan(200);
		expect(rows[0].rr_ms).toBe('750 740');
		expect(rows[0].ts).toBeGreaterThanOrEqual(started);
		const sum = admin.summaryRows().find((r) => r.pid === 'P01')!;
		expect(sum.hr_mean_survey).toBe(81);
		expect(sum.hr_peak_survey).toBe(82);
		expect(admin.status().straps).toMatchObject([{ strap: 'dev-1', bpm: 82, pid: 'P01' }]);
	});

	it('exports unassigned readings too, and archives with the participant', () => {
		hr.recordHr([{ strap: 'dev-2', strap_name: null, pid: null, ts: Date.now(), bpm: 70, rr: [], contact: null }], Date.now());
		const csv = admin.tableCsv('hr_samples');
		expect(csv).toContain('dev-1');
		expect(csv).toContain('dev-2');
		const to = session.archiveParticipant('P01', 'v1');
		expect(admin.tableCsv('hr_samples')).not.toContain('dev-1');
		expect(admin.tableCsv('archive_hr_samples')).toContain(to);
	});

	it('rejects malformed uploads', () => {
		expect(() => hr.recordHr([{ strap: '', ts: 1, bpm: 60 }], 1)).toThrow();
		expect(() => hr.recordHr([{ strap: 'x', ts: 1, bpm: 60.5 }], 1)).toThrow();
		expect(() => hr.recordHr([{ strap: 'x', pid: "P01'; DROP", ts: 1, bpm: 60 }], 1)).toThrow();
		expect(() => hr.recordHr('nope', 1)).toThrow();
	});
});

describe('applyStrapPeaks', () => {
	it('prefers the strap peak, falls back to the typed value, and recomputes %HRmax', () => {
		const [r] = applyStrapPeaks([{ age: 20, peak_hr_1: 150, peak_hr_2: 160, hr_peak_interval1: 172, hr_peak_interval2: null }]);
		expect(r.peak_hr_1).toBe(172);
		expect(r.peak_hr_source_1).toBe('strap');
		expect(r.peak_hr_entered_1).toBe(150);
		expect(r.pct_hrmax_1).toBeCloseTo(172 / 200, 10);
		expect(r.peak_hr_2).toBe(160);
		expect(r.peak_hr_source_2).toBe('entered');
	});
	it('fills strap peaks when nothing was typed in, and leaves blanks blank', () => {
		const [r] = applyStrapPeaks([{ age: null, peak_hr_1: null, peak_hr_2: null, hr_peak_interval2: 131 }]);
		expect(r.peak_hr_1).toBeNull();
		expect(r.peak_hr_source_1).toBeNull();
		expect(r.peak_hr_2).toBe(131);
		expect(r.pct_hrmax_2).toBeNull();
	});
});

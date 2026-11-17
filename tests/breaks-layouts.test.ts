/**
 * Exercise/rest countdowns, RPE only for the exercise condition, the break after Game B,
 * per-participant card layouts and the side-by-side variants. Uses a throwaway DATA_DIR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAdjacentPair } from '../src/lib/layout';
import { hasVariant } from '../src/lib/sa-plan';
import { FACILITATOR_PHASES, PHASES, type ExperimentConfig, type ThemeManifest } from '../src/lib/types';
import { validateExperiment } from '../src/lib/validate';

let dir: string;
let session: typeof import('../src/lib/server/session');
let admin: typeof import('../src/lib/server/admin');
let db: typeof import('../src/lib/server/db');
const config: ExperimentConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const manifest = (t: string): ThemeManifest => JSON.parse(fs.readFileSync(`assets/themes/${t}/manifest.json`, 'utf8'));

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-breaks-'));
	process.env.DATA_DIR = dir;
	fs.writeFileSync(path.join(dir, 'schedule.csv'), 'pid,condition,board_a_theme,board_b_theme,seed\nP07,rest,mit,transport,1\nP08,rest,mit,transport,1\n');
	session = await import('../src/lib/server/session');
	admin = await import('../src/lib/server/admin');
	db = await import('../src/lib/server/db');
});
afterAll(() => {
	db.getDb().close();
	fs.rmSync(dir, { recursive: true, force: true });
});

const newSession = (condition: string, phase: (typeof PHASES)[number], fast = false) =>
	session.createTestSession({ condition, board_a_theme: 'mit', board_b_theme: 'transport', phase, fast });
const state = (pid: string) => session.buildState(session.getSession(pid)!);

describe('exercise / rest countdowns', () => {
	it('runs 5:00 before Game A and 1:00 before Game B; fast timers shorten them to 10 s', () => {
		expect(state(newSession('rest', 'interval1')).timers.interval_ms).toEqual({ interval1: 300_000, interval2: 60_000 });
		expect(state(newSession('rest', 'interval1', true)).timers.interval_ms).toEqual({ interval1: 10_000, interval2: 10_000 });
	});

	it('waits for Start: the countdown begins at the interval start marker', () => {
		const pid = newSession('rest', 'interval1');
		expect(state(pid).progress.markers).toEqual([]);
		const at = session.mark(pid, 'interval1', 'start', 123);
		expect(state(pid).progress.markers).toEqual([{ name: 'start', at }]);
		expect(() => session.mark(pid, 'interval1', 'bogus', 1)).toThrow();
	});

	it('records RPE only for the exercise condition', () => {
		expect(state(newSession('elevated_hr', 'interval1')).recordRpe).toBe(true);
		expect(state(newSession('rest', 'interval1')).recordRpe).toBe(false);
	});

	it('rejects bad timer and RPE settings', () => {
		const all = Object.fromEntries(['mit', 'transport', config.practice_board.theme].map((t) => [t, manifest(t)]));
		const layouts = JSON.parse(fs.readFileSync('assets/layouts.json', 'utf8'));
		const bad = { ...config, interval_timer_s: { interval1: -1, interval3: 5 } as never, rpe_conditions: ['nap'] };
		expect(validateExperiment(bad, all, layouts, () => true)).toEqual([
			'config.interval_timer_s.interval1 must be a number of seconds >= 0 (0 = no countdown)',
			'config.interval_timer_s: unknown key "interval3" (interval1 or interval2)',
			'config.rpe_conditions: "nap" is not one of config.conditions'
		]);
	});
});

describe('break after Game B', () => {
	it('comes between board_b and the questions, and only the facilitator ends it', () => {
		expect(PHASES.slice(PHASES.indexOf('board_b'), PHASES.indexOf('sa') + 1)).toEqual(['board_b', 'break', 'sa']);
		expect(FACILITATOR_PHASES).toContain('break');
		const pid = newSession('rest', 'break');
		expect(() => session.advance(pid, 'break', { facilitator: false, clientTs: null })).toThrow();
		expect(session.advance(pid, 'break', { facilitator: true, clientTs: null }).phase).toBe('sa');
	});
});

describe('card layouts', () => {
	it('are random per participant, stable for that participant, and always use the same 8 objects', () => {
		const pids = Array.from({ length: 6 }, () => newSession('rest', 'board_a'));
		const boards = pids.map((p) => state(p).boards);
		for (const key of ['A', 'B'] as const) {
			const theme = key === 'A' ? 'mit' : 'transport';
			const ids = manifest(theme).objects.map((o) => o.id).sort();
			for (const b of boards) {
				expect([...new Set(b[key].cards)].sort()).toEqual(ids);
				expect(b[key].cards).toHaveLength(16);
				expect(hasAdjacentPair(b[key].cards, b[key].cols)).toBe(false);
			}
			expect(new Set(boards.map((b) => b[key].cards.join())).size).toBeGreaterThan(1);
		}
		// reopening gives the same board
		expect(state(pids[0]).boards).toEqual(boards[0]);
		// the explorer draws the participant's own layout
		const detail = admin.participantDetail(pids[0])!;
		expect(detail.layouts.mit.cards).toEqual(boards[0].A.cards);
		expect(detail.layouts.transport.cards).toEqual(boards[0].B.cards);
	});

	it('scores clicks against the participant\'s own layout', () => {
		const pid = newSession('rest', 'board_a');
		const cards = state(pid).boards.A.cards;
		const first = cards.indexOf(cards[0], 0);
		const partner = cards.indexOf(cards[0], 1);
		session.recordClick(pid, { board: 'A', seq: 0, card_index: first, outcome: 'first_flip', client_ts: 1 });
		session.recordClick(pid, { board: 'A', seq: 1, card_index: partner, outcome: 'match', client_ts: 2 });
		const row = db.getDb().prepare('SELECT object_id FROM clicks WHERE pid = ? ORDER BY seq').all(pid) as { object_id: string }[];
		expect(row.map((r) => r.object_id)).toEqual([cards[0], cards[0]]);
		const summary = admin.summaryRows(true).find((r) => r.pid === pid)!;
		expect(summary.A_pairs_found).toBe(1);
	});
});

describe('side-by-side variants', () => {
	it('are asked only about objects whose variant really looks different', () => {
		const withVariant = (t: string) => manifest(t).objects.filter(hasVariant).map((o) => o.id);
		expect(withVariant('transport')).toEqual(['plane', 'scooter', 'helicopter', 'rocket']);
		// no color-shift variants left in either theme
		for (const t of ['mit', 'transport']) for (const o of manifest(t).objects) expect(o.variant?.color_shift_deg).toBeUndefined();
		expect(withVariant('mit')).toEqual(['beaver', 'apollo_capsule', 'mit_logo', 'muddy_charles', 'integral']);
	});

	it('has no flying foil in transport, so "how many could fly" is only about the game', () => {
		const flying = ['plane', 'helicopter', 'rocket', 'hot_air_balloon'];
		expect(manifest('transport').foils.filter((o) => flying.includes(o.id))).toEqual([]);
		expect(manifest('transport').objects.filter((o) => flying.includes(o.id))).toHaveLength(3);
	});

	it('uses flat icons only, no photos', () => {
		for (const t of ['mit', 'transport'])
			for (const o of [...manifest(t).objects, ...manifest(t).foils]) {
				expect(o.render).toBeUndefined();
				expect(o.image).toMatch(/\.svg$/);
			}
	});
});

describe('archive', () => {
	it('keeps the data under ARCHIVE-<tag>-<pid>, out of the normal exports, and frees the pid', () => {
		const pid = session.openSession('P07').pid;
		db.getDb().prepare("INSERT INTO clicks (pid, board, theme, seq, card_index, object_id, outcome, client_ts, server_ts) VALUES (?, 'A', 'mit', 0, 0, 'beaver', 'first_flip', 1, 1)").run(pid);
		const cards = state(pid).boards.A.cards;
		const to = session.archiveParticipant(pid, 'v1');
		expect(to).toBe('ARCHIVE-v1-P07');
		expect(session.getSession(pid)).toBeUndefined();
		expect(db.getDb().prepare('SELECT COUNT(*) n FROM clicks WHERE pid = ?').get(to)).toEqual({ n: 1 });
		expect(state(to).boards.A.cards).toEqual(cards);
		expect(admin.tableCsv('clicks')).not.toContain(to);
		expect(admin.tableCsv('archive_clicks')).toContain(to);
		expect(admin.summaryRows().some((r) => r.pid === to)).toBe(false);
		expect(admin.summaryRows('archive').map((r) => r.pid)).toEqual([to]);
		// the schedule slot can be run again
		expect(session.openSession('P07').pid).toBe('P07');
		expect(() => session.archiveParticipant(to, 'v2')).toThrow();
	});

	it('stores the given layout for a session that used the shared one', () => {
		const pid = session.openSession('P08').pid;
		db.getDb().prepare('UPDATE sessions SET layouts = NULL WHERE pid = ?').run(pid);
		const old = { A: Array(16).fill('x'), B: Array(16).fill('y') };
		const to = session.archiveParticipant(pid, 'v1', old);
		expect(JSON.parse(session.getSession(to)!.layouts!)).toEqual(old);
	});
});

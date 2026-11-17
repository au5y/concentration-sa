/** Remote participants (RP): links, per-pid access, no environment questions, schedule add/remove. Throwaway DATA_DIR. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cellKey, extendSchedule, generateSchedule } from '../src/lib/schedule';
import type { SaStep } from '../src/lib/sa-plan';

let dir: string;
let session: typeof import('../src/lib/server/session');
let remote: typeof import('../src/lib/server/remote');
let sched: typeof import('../src/lib/server/schedule');
let files: typeof import('../src/lib/server/files');
let edit: typeof import('../src/lib/server/edit');
let hr: typeof import('../src/lib/server/hr');
let con: typeof import('../src/lib/server/remote-console');
let db: typeof import('../src/lib/server/db');

function jar(): Cookies {
	const store = new Map<string, string>();
	return {
		get: (n: string) => store.get(n),
		set: (n: string, v: string) => void store.set(n, v),
		delete: (n: string) => void store.delete(n)
	} as unknown as Cookies;
}
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return 200;
};
const oral = (pid: string) => (JSON.parse(session.getSession(pid)!.sa_plan) as SaStep[]).filter((s) => s.type === 'oral').length;

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-remote-'));
	process.env.DATA_DIR = dir;
	session = await import('../src/lib/server/session');
	remote = await import('../src/lib/server/remote');
	sched = await import('../src/lib/server/schedule');
	files = await import('../src/lib/server/files');
	edit = await import('../src/lib/server/edit');
	hr = await import('../src/lib/server/hr');
	con = await import('../src/lib/server/remote-console');
	db = await import('../src/lib/server/db');
});
afterEach(() => {
	delete process.env.ADMIN_PASSWORD;
	delete process.env.RUN_PASSWORD;
});
afterAll(() => {
	db.getDb().close();
	fs.rmSync(dir, { recursive: true, force: true });
});

describe('schedule', () => {
	it('starts from nothing, adds remote and in-person rows, removes unstarted ones', () => {
		const [a, b] = sched.addToSchedule(2);
		const [r] = sched.addToSchedule(1, true);
		expect([a, b, r]).toEqual(['P01', 'P02', 'P03']);
		expect(files.loadSchedule().map((x) => !!x.remote)).toEqual([false, false, true]);
		session.openSession(a);
		expect(status(() => sched.removeFromSchedule([a]))).toBe(409);
		expect(sched.removeFromSchedule([b])).toEqual([b]);
		expect(files.loadSchedule().map((x) => x.pid)).toEqual([a, r]);
		sched.setScheduleRemote(r, false);
		expect(files.loadSchedule()[1].remote).toBe(false);
		sched.setScheduleRemote(r, true);
	});

	it('refills the short groups after rows are removed', () => {
		const base = { conditions: ['rest', 'elevated_hr'], theme_orders: [['mit', 'transport'], ['transport', 'mit']] };
		const all = generateSchedule({ ...base, n: 30, seed: 3 });
		// Drop the first four rest participants.
		const drop = new Set(all.filter((x) => x.condition === 'rest').slice(0, 4).map((x) => x.pid));
		const rows = extendSchedule(all.filter((x) => !drop.has(x.pid)), { ...base, add: 4, taken: drop });
		const counts = new Map<string, number>();
		for (const x of rows) counts.set(cellKey(x), (counts.get(cellKey(x)) ?? 0) + 1);
		expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
		expect(rows.slice(-4).every((x) => !drop.has(x.pid))).toBe(true);
	});
});

describe('remote sessions', () => {
	it('get the RP tag and no environment questions', () => {
		const rp = files.loadSchedule().find((x) => x.remote)!.pid;
		const inPerson = files.loadSchedule().find((x) => !x.remote)!.pid;
		session.openSession(rp);
		expect(session.getSession(rp)!.tags).toBe('RP');
		expect(session.buildState(session.getSession(rp)!).remote).toBe(true);
		expect(oral(rp)).toBe(0);
		expect(oral(inPerson)).toBeGreaterThan(0);
	});

	it('switching the RP tag rebuilds the plan until questions are answered', () => {
		const pid = files.loadSchedule().find((x) => !x.remote)!.pid;
		edit.editParticipant(pid, { tags: ['RP', 'stairs'] });
		expect(oral(pid)).toBe(0);
		edit.editParticipant(pid, { tags: ['stairs'] });
		expect(oral(pid)).toBeGreaterThan(0);
	});

	it('links only open their own session and cannot advance facilitator phases', () => {
		process.env.ADMIN_PASSWORD = 'admin-pw';
		const rp = files.loadSchedule().find((x) => x.remote)!.pid;
		const other = files.loadSchedule().find((x) => !x.remote)!.pid;
		const c = jar();
		expect(remote.remoteLogin(c, rp, 'wrong')).toBe(false);
		expect(remote.remoteLogin(c, other, remote.remoteKey(other))).toBe(false); // not remote
		expect(remote.remoteLogin(c, rp, remote.remoteKey(rp))).toBe(true);
		expect(remote.remotePid(c)).toBe(rp);
		expect(remote.sessionPid(c, rp)).toBe(rp);
		expect(status(() => remote.sessionPid(c, other))).toBe(403);
		expect(status(() => remote.sessionPid(jar(), rp))).toBe(403);
	});

	it('the console moves a remote session through the facilitator phases', () => {
		const rp = files.loadSchedule().find((x) => x.remote)!.pid;
		session.recordSurvey(rp, { age: 22, exercise_days: 2, fitness: 3, hours_slept: 7 }, null);
		expect(session.getSession(rp)!.phase).toBe('baseline');
		con.consoleAction(rp, { action: 'start', phase: 'baseline' });
		con.consoleAction(rp, { action: 'advance', phase: 'baseline' });
		expect(session.getSession(rp)!.phase).toBe('practice');
		expect(status(() => con.consoleAction(rp, { action: 'advance', phase: 'baseline' }))).toBe(409);
		con.consoleAction(rp, { action: 'advance', phase: 'practice' });
		con.consoleAction(rp, { action: 'bout', phase: 'interval1', rpe: 14, peak_hr: 150 });
		expect(con.consoleState(rp)!.bout).toEqual({ rpe: 14, peak_hr: 150 });
	});

	it('stores a participant strap reading under their own pid', () => {
		const rp = files.loadSchedule().find((x) => x.remote)!.pid;
		const now = Date.now();
		hr.recordHr([{ strap: 'dev1', strap_name: 'H10', pid: 'P99', ts: now, bpm: 101, rr: [], contact: true }], now, rp);
		expect(con.consoleState(rp)!.hr.at(-1)!.bpm).toBe(101);
		expect(con.consoleState(rp)!.peak).toBe(101);
	});
});

describe('ending a session early', () => {
	it('closes it, tags it and refuses further data', () => {
		const [pid] = sched.addToSchedule(1);
		session.openSession(pid);
		session.recordSurvey(pid, { age: 30, exercise_days: 1, fitness: 2, hours_slept: 6 }, null);
		con.consoleAction(pid, { action: 'abort', reason: 'left during baseline' });
		const s = session.getSession(pid)!;
		expect(s.aborted_at).toBeTruthy();
		expect(s.abort_reason).toBe('left during baseline');
		expect(s.tags).toContain('aborted');
		expect(session.buildState(s).aborted).toBe(true);
		expect(status(() => session.mark(pid, 'baseline', 'start', null))).toBe(409);
		expect(status(() => con.consoleAction(pid, { action: 'advance', phase: 'baseline' }))).toBe(409);
		expect(status(() => con.consoleAction(pid, { action: 'abort' }))).toBe(409);
		const open = db.getDb().prepare('SELECT COUNT(*) AS n FROM phases WHERE pid = ? AND ended_at IS NULL').get(pid) as { n: number };
		expect(open.n).toBe(0);
	});
});

describe('console override', () => {
	it('fills the survey, restarts from the beginning and resumes an ended session', () => {
		const [pid] = sched.addToSchedule(1);
		session.openSession(pid);
		con.consoleAction(pid, { action: 'survey', phase: 'survey', answers: { age: 25, exercise_days: 4, fitness: 4, hours_slept: 8 } });
		expect(con.consoleState(pid)!.survey).toEqual({ age: 25, exercise_days: 4, fitness: 4, hours_slept: 8 });
		expect(session.getSession(pid)!.phase).toBe('baseline');

		con.consoleAction(pid, { action: 'jump', to: 'board_a' });
		session.mark(pid, 'board_a', 'preview', null);
		session.recordClick(pid, { board: 'A', seq: 0, card_index: 0, outcome: 'first_flip', client_ts: 1 });
		const st = con.consoleState(pid)!;
		expect(st.live!.clicks).toHaveLength(1);
		expect(st.manifest!.objects.length).toBeGreaterThan(0);

		con.consoleAction(pid, { action: 'abort', reason: 'left' });
		con.consoleAction(pid, { action: 'jump', to: 'board_a' });
		const s = session.getSession(pid)!;
		expect(s.aborted_at).toBeNull();
		expect(s.tags).not.toContain('aborted');
		expect(con.consoleState(pid)!.live!.clicks).toHaveLength(0);

		con.consoleAction(pid, { action: 'jump', to: 'survey' });
		expect(con.consoleState(pid)!.survey).toBeNull();
		const log = db.getDb().prepare("SELECT field FROM edits WHERE pid = ? AND field LIKE 'phase%'").all(pid);
		expect(log.length).toBe(3);
	});
});

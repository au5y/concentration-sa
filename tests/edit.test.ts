/** Admin corrections: tags, condition, survey, bouts and PID changes, with the edits log. Uses a throwaway DATA_DIR. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
let session: typeof import('../src/lib/server/session');
let edit: typeof import('../src/lib/server/edit');
let admin: typeof import('../src/lib/server/admin');
let db: typeof import('../src/lib/server/db');
let presets: typeof import('../src/lib/server/tag-presets');

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-edit-'));
	process.env.DATA_DIR = dir;
	session = await import('../src/lib/server/session');
	edit = await import('../src/lib/server/edit');
	admin = await import('../src/lib/server/admin');
	db = await import('../src/lib/server/db');
	presets = await import('../src/lib/server/tag-presets');
});
afterAll(() => {
	db.getDb().close();
	fs.rmSync(dir, { recursive: true, force: true });
});

const status = (e: unknown) => (e as { status?: number }).status;
function newSession(): string {
	const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'survey', fast: true });
	session.recordSurvey(pid, { age: 21, exercise_days: 3, fitness: 3, hours_slept: 7 }, null);
	return pid;
}
const edits = (pid: string) => db.getDb().prepare('SELECT field, old_value, new_value FROM edits WHERE pid = ? ORDER BY id').all(pid);

describe('editParticipant', () => {
	it('sets tags, trimmed and de-duplicated', () => {
		const pid = newSession();
		edit.editParticipant(pid, { tags: [' stairs ', 'Stairs', 'late  start', ''] });
		expect(session.getSession(pid)!.tags).toBe('stairs, late start');
		expect(edit.splitTags(session.getSession(pid)!.tags)).toEqual(['stairs', 'late start']);
		expect(() => edit.editParticipant(pid, { tags: ['a,b'] })).toThrow();
	});

	it('corrects condition, survey and bouts and logs each change', () => {
		const pid = newSession();
		const r = edit.editParticipant(pid, {
			condition: 'elevated_hr',
			survey: { age: 22, exercise_days: 3, fitness: 3, hours_slept: 6.5 },
			bouts: { interval1: { rpe: 15, peak_hr: 160 } }
		});
		expect(r.changed).toEqual(['condition', 'survey.age', 'survey.hours_slept', 'interval1.rpe', 'interval1.peak_hr']);
		expect(session.getSession(pid)!.condition).toBe('elevated_hr');
		expect(db.getDb().prepare('SELECT age, hours_slept FROM survey WHERE pid = ?').get(pid)).toEqual({ age: 22, hours_slept: 6.5 });
		expect(edits(pid)[0]).toEqual({ field: 'condition', old_value: 'rest', new_value: 'elevated_hr' });
		// No change → nothing logged; null removes the bout.
		expect(edit.editParticipant(pid, { condition: 'elevated_hr' }).changed).toEqual([]);
		edit.editParticipant(pid, { bouts: { interval1: null } });
		expect(db.getDb().prepare('SELECT 1 FROM bouts WHERE pid = ?').get(pid)).toBeUndefined();
	});

	it('rejects bad values without changing anything', () => {
		const pid = newSession();
		expect(() => edit.editParticipant(pid, { condition: 'elevated_hr', survey: { age: 5, exercise_days: 3, fitness: 3, hours_slept: 7 } })).toThrow();
		expect(session.getSession(pid)!.condition).toBe('rest');
		try {
			edit.editParticipant(pid, { condition: 'swimming' });
		} catch (e) {
			expect(status(e)).toBe(400);
		}
	});

	it('changes the participant ID, moving every row', () => {
		const pid = newSession();
		const other = newSession();
		edit.editParticipant(pid, { tags: ['burpees'] });
		try {
			edit.editParticipant(pid, { pid: other });
			expect.unreachable();
		} catch (e) {
			expect(status(e)).toBe(409);
		}
		const r = edit.editParticipant(pid, { pid: 'P042' });
		expect(r.pid).toBe('P042');
		expect(session.getSession(pid)).toBeUndefined();
		expect(session.getSession('P042')!.tags).toBe('burpees');
		expect(db.getDb().prepare('SELECT COUNT(*) AS n FROM phases WHERE pid = ?').get('P042')).toEqual({ n: expect.any(Number) });
		expect(db.getDb().prepare('SELECT 1 AS x FROM survey WHERE pid = ?').get('P042')).toEqual({ x: 1 });
		expect(edits('P042').map((e: any) => e.field)).toEqual(['tags', 'pid']);
		// Tags reach the summary export.
		expect(admin.summaryRows('real').find((x) => x.pid === 'P042')).toMatchObject({ tags: 'burpees' });
		expect(admin.tableCsv('edits')).toContain('P042,pid,');
	});
});

describe('suggested tags', () => {
	it('start from the defaults, then save trimmed and de-duplicated', () => {
		expect(presets.getTagPresets()).toEqual(presets.DEFAULT_TAG_PRESETS);
		expect(presets.saveTagPresets(['stairs', ' Stairs', 'jumping  jacks', ''])).toEqual(['stairs', 'jumping jacks']);
		expect(presets.getTagPresets()).toEqual(['stairs', 'jumping jacks']);
		expect(() => presets.saveTagPresets(['a,b'])).toThrow();
	});
});

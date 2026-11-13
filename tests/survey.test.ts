/**
 * The survey is the first phase and asks age, exercise days, fitness and hours slept only.
 * Runs the server code against a throwaway DATA_DIR that starts with an old-schema database.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHASES } from '../src/lib/types';

let dir: string;
let session: typeof import('../src/lib/server/session');
let db: typeof import('../src/lib/server/db');

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-survey-'));
	// A database from before caffeine / color vision were removed, with one answer in it.
	const old = new Database(path.join(dir, 'experiment.db'));
	old.exec(`CREATE TABLE survey (pid TEXT PRIMARY KEY, age INTEGER NOT NULL, exercise_days INTEGER NOT NULL, fitness INTEGER NOT NULL,
		hours_slept REAL NOT NULL, caffeine TEXT NOT NULL, color_vision TEXT NOT NULL, server_ts INTEGER NOT NULL)`);
	old.prepare('INSERT INTO survey VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('OLD-1', 30, 2, 3, 7, 'yes', 'no', 1);
	old.close();
	process.env.DATA_DIR = dir;
	session = await import('../src/lib/server/session');
	db = await import('../src/lib/server/db');
});
afterAll(() => {
	db.getDb().close();
	fs.rmSync(dir, { recursive: true, force: true });
});

const answers = { age: 25, exercise_days: 3, fitness: 4, hours_slept: 7.5 };

describe('survey', () => {
	it('comes first, before the baseline', () => {
		expect(PHASES[0]).toBe('survey');
		expect(PHASES[1]).toBe('baseline');
		expect(PHASES.at(-2)).toBe('sa');
		expect(PHASES.at(-1)).toBe('done');
	});

	it('drops the caffeine and color-vision columns and keeps the other answers', () => {
		const cols = (db.getDb().prepare('PRAGMA table_info(survey)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toEqual(['pid', 'age', 'exercise_days', 'fitness', 'hours_slept', 'server_ts']);
		expect(db.getDb().prepare("SELECT age, hours_slept FROM survey WHERE pid = 'OLD-1'").get()).toEqual({ age: 30, hours_slept: 7 });
	});

	it('records the four answers and moves on to the baseline', () => {
		const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'survey', fast: true });
		expect(() => session.advance(pid, 'survey', { facilitator: true, clientTs: null })).toThrow(); // not submitted yet
		const s = session.recordSurvey(pid, answers, 1);
		expect(s.phase).toBe('baseline');
		const { pid: _p, server_ts: _t, ...row } = db.getDb().prepare('SELECT * FROM survey WHERE pid = ?').get(pid) as Record<string, unknown>;
		expect(row).toEqual({ age: 25, exercise_days: 3, fitness: 4, hours_slept: 7.5 });
	});

	it('ends the session after the SA questions', () => {
		const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'sa', fast: true });
		const plan = JSON.parse(session.getSession(pid)!.sa_plan) as { length: number };
		db.getDb().prepare('UPDATE sessions SET sa_plan = ? WHERE pid = ?').run('[]', pid);
		expect(plan.length).toBe(18);
		expect(session.advance(pid, 'sa', { facilitator: false, clientTs: null }).phase).toBe('done');
	});
});

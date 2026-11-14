import { error } from '@sveltejs/kit';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './files';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	pid TEXT PRIMARY KEY,
	condition TEXT NOT NULL,
	board_a_theme TEXT NOT NULL,
	board_b_theme TEXT NOT NULL,
	schedule_seed INTEGER,
	phase TEXT NOT NULL,
	phase_started_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	dev_timers INTEGER NOT NULL DEFAULT 0,
	sa_plan TEXT NOT NULL,
	-- This participant's card layouts, JSON {"A": [object id per card], "B": [...]}.
	-- NULL for sessions started before layouts were per participant (they used assets/layouts.json).
	layouts TEXT
);
-- One row per phase, plus marker rows such as baseline.start, board_a.preview,
-- board_a.play (cards flipped face down) and board_a.resume (page reloaded).
CREATE TABLE IF NOT EXISTS phases (
	id INTEGER PRIMARY KEY,
	pid TEXT NOT NULL,
	phase TEXT NOT NULL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	client_started_at REAL,
	client_ended_at REAL
);
CREATE INDEX IF NOT EXISTS phases_pid ON phases(pid);
CREATE TABLE IF NOT EXISTS clicks (
	id INTEGER PRIMARY KEY,
	pid TEXT NOT NULL,
	board TEXT NOT NULL,
	theme TEXT NOT NULL,
	seq INTEGER NOT NULL,
	card_index INTEGER NOT NULL,
	object_id TEXT NOT NULL,
	outcome TEXT NOT NULL,
	client_ts REAL NOT NULL,
	server_ts INTEGER NOT NULL,
	UNIQUE (pid, board, seq)
);
CREATE TABLE IF NOT EXISTS sa_responses (
	id INTEGER PRIMARY KEY,
	pid TEXT NOT NULL,
	seq INTEGER NOT NULL,
	board TEXT NOT NULL,
	theme TEXT NOT NULL,
	question_type TEXT NOT NULL,
	item TEXT NOT NULL,
	target TEXT NOT NULL,
	response TEXT NOT NULL,
	correct INTEGER NOT NULL,
	confidence INTEGER,
	rt_ms REAL,
	confidence_rt_ms REAL,
	submit_rt_ms REAL,
	answer_changes INTEGER,
	confidence_changes INTEGER,
	presented TEXT,
	client_ts REAL,
	server_ts INTEGER NOT NULL,
	UNIQUE (pid, seq, item)
);
-- Questions at the start of the session, filled in by the facilitator.
CREATE TABLE IF NOT EXISTS survey (
	pid TEXT PRIMARY KEY,
	age INTEGER NOT NULL,
	exercise_days INTEGER NOT NULL,
	fitness INTEGER NOT NULL,
	hours_slept REAL NOT NULL,
	server_ts INTEGER NOT NULL
);
-- Manipulation check per exercise/rest bout (interval1 = before Game A, interval2 = before Game B),
-- entered by the facilitator at the end of the bout.
CREATE TABLE IF NOT EXISTS bouts (
	pid TEXT NOT NULL,
	bout TEXT NOT NULL,
	rpe INTEGER NOT NULL,
	peak_hr INTEGER,
	server_ts INTEGER NOT NULL,
	PRIMARY KEY (pid, bout)
);
`;

export const TABLES = ['sessions', 'phases', 'clicks', 'sa_responses', 'bouts', 'survey'] as const;

/** Bring older database files up to the current schema. */
function migrate(d: Database.Database) {
	const cols = (t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
	// v1 survey had a single end-of-session rpe and no age/fitness. Keep any old rows in survey_v1.
	if (cols('survey').includes('rpe')) {
		d.exec('ALTER TABLE survey RENAME TO survey_v1');
	}
	// The caffeine and color-vision questions were removed from the survey.
	for (const c of ['caffeine', 'color_vision']) if (cols('survey').includes(c)) d.exec(`ALTER TABLE survey DROP COLUMN ${c}`);
	// Card layouts became per participant.
	const sessionCols = cols('sessions');
	if (sessionCols.length && !sessionCols.includes('layouts')) d.exec('ALTER TABLE sessions ADD COLUMN layouts TEXT');
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (db) return db;
	fs.mkdirSync(paths.data, { recursive: true });
	const file = path.join(paths.data, 'experiment.db');
	// A DB created by the Docker container is owned by root; outside Docker it is then read-only.
	for (const f of [file, `${file}-wal`, `${file}-shm`]) {
		try {
			if (fs.existsSync(f)) fs.accessSync(f, fs.constants.W_OK);
		} catch {
			error(500, `${f} is not writable by this server (owned by root from Docker?). Fix: sudo chown $USER ${file}*`);
		}
	}
	db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	if ((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='survey'").get())) migrate(db);
	db.exec(SCHEMA);
	return db;
}

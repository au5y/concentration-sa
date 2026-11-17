import { error, type Cookies } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { toCsv } from '../csv';
import { hrByPhase, type PhaseSpan } from '../hr';
import { buildSummary, rescoreFixedAnswers } from '../metrics';
import { PHASES } from '../types';
import { getDb, TABLES } from './db';
import { experiment } from './experiment';
import { loadSchedule } from './files';
import { ARCHIVE_PREFIX, sessionCards, TEST_PREFIX } from './session';

const COOKIE = 'admin_token';
/** SQL filters: real participants (no TEST-n, no ARCHIVE-…), and archived ones only. */
const REAL = `pid NOT LIKE '${TEST_PREFIX}%' AND pid NOT LIKE '${ARCHIVE_PREFIX}%'`;
const ARCHIVED = `pid LIKE '${ARCHIVE_PREFIX}%'`;
export type Scope = 'real' | 'archive' | 'all';
const WHERE: Record<Scope, string> = { real: REAL, archive: ARCHIVED, all: '1 = 1' };

function token(): string | null {
	const pw = process.env.ADMIN_PASSWORD;
	if (!pw) return null;
	return crypto.createHmac('sha256', pw).update('concentration-admin').digest('hex');
}

export const adminEnabled = () => !!process.env.ADMIN_PASSWORD;

export function isAdmin(cookies: Cookies): boolean {
	const t = token();
	const c = cookies.get(COOKIE);
	return !!t && !!c && c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}

export function requireAdmin(cookies: Cookies) {
	if (!isAdmin(cookies)) error(401, 'admin login required');
}

export function login(cookies: Cookies, password: string): boolean {
	const pw = process.env.ADMIN_PASSWORD;
	if (!pw) return false;
	const a = crypto.createHash('sha256').update(password).digest();
	const b = crypto.createHash('sha256').update(pw).digest();
	if (!crypto.timingSafeEqual(a, b)) return false;
	// secure: false because stations usually talk plain HTTP on the local network.
	cookies.set(COOKIE, token()!, { path: '/', httpOnly: true, sameSite: 'strict', secure: false, maxAge: 60 * 60 * 12 });
	return true;
}

export function logout(cookies: Cookies) {
	cookies.delete(COOKIE, { path: '/', secure: false });
}

/** Add human-readable ISO columns next to every epoch-ms timestamp column. */
function withIso(rows: Record<string, unknown>[]): Record<string, unknown>[] {
	return rows.map((r) => {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(r)) {
			out[k] = v;
			if (/(^ts|_at|_ts)$/.test(k)) out[`${k}_iso`] = typeof v === 'number' && v > 1e12 ? new Date(v).toISOString() : '';
		}
		return out;
	});
}

/** CSV of one table, or the summary. `archive_<name>` exports the archived sessions instead. */
export function tableCsv(name: string): string {
	const db = getDb();
	let scope: Scope = 'real';
	if (name.startsWith('archive_')) [scope, name] = ['archive', name.slice('archive_'.length)];
	if (name === 'summary') return toCsv(summaryRows(scope));
	if (!(TABLES as readonly string[]).includes(name)) error(404, 'unknown table');
	const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
	let rows = db.prepare(`SELECT * FROM ${name} WHERE ${name === 'hr_samples' && scope === 'real' ? `(${REAL} OR pid IS NULL)` : WHERE[scope]} ORDER BY rowid`).all() as Record<string, unknown>[];
	if (name === 'sa_responses') rows = rescore(rows as any[]);
	const isoRows = withIso(rows);
	const header = rows.length ? Object.keys(isoRows[0]) : cols;
	return toCsv(isoRows, header);
}

/** One summary row per participant: real ones (default), archived ones, or all incl. tests. */
export function summaryRows(scope: Scope | boolean = 'real'): Record<string, unknown>[] {
	const db = getDb();
	const exp = experiment();
	const where = WHERE[scope === true ? 'all' : scope === false ? 'real' : scope];
	const all = (sql: string) => db.prepare(sql).all() as any[];
	const layouts = Object.fromEntries(Object.entries(exp.layouts.layouts).map(([t, l]) => [t, l.cards]));
	const rows = buildSummary({
		sessions: all(`SELECT * FROM sessions WHERE ${where} ORDER BY pid`),
		phases: all(`SELECT pid, phase, client_started_at FROM phases WHERE ${where} ORDER BY id`),
		clicks: all(`SELECT pid, board, seq, card_index, object_id, outcome, client_ts FROM clicks WHERE ${where}`),
		sa: rescore(all(`SELECT pid, board, theme, item, question_type, target, response, correct, confidence FROM sa_responses WHERE ${where}`)),
		survey: all(`SELECT * FROM survey WHERE ${where}`),
		bouts: all(`SELECT pid, bout, rpe, peak_hr FROM bouts WHERE ${where}`),
		layouts,
		saTypes: [...exp.config.sa_questions, ...level2Types(), ...(exp.config.oral_sa_questions?.length ? ['oral'] : [])]
	});
	// Heart rate per phase from the Bluetooth straps (columns only when there is any HR data).
	const hr = hrByPhase(
		all(`SELECT pid, ts, bpm, contact FROM hr_samples WHERE pid IS NOT NULL AND ${where}`),
		all(`SELECT pid, phase, started_at, ended_at FROM phases WHERE ${where}`) as PhaseSpan[]
	);
	if (!Object.keys(hr).length) return rows;
	const blank = Object.fromEntries(Object.keys(Object.values(hr)[0]).map((k) => [k, null]));
	return rows.map((r) => ({ ...r, ...blank, ...hr[r.pid as string] }));
}

/** Level 2 question types present in the config (level2_color, level2_count). */
function level2Types(): string[] {
	const qs = Object.values(experiment().config.sa_level2_questions ?? {}).flat();
	return (['color_pair', 'count'] as const).filter((k) => qs.some((q) => q.kind === k)).map((k) => (k === 'color_pair' ? 'level2_color' : 'level2_count'));
}

/** Score Level 2 answers against the current config (an answer may be corrected later). */
function rescore<T extends Parameters<typeof rescoreFixedAnswers>[0][number]>(rows: T[]): T[] {
	const { config } = experiment();
	return rescoreFixedAnswers(rows, config.sa_level2_questions);
}

export function status() {
	const db = getDb();
	const sessions = db
		.prepare(
			`SELECT s.pid, s.condition, s.tags, s.board_a_theme, s.board_b_theme, s.phase, s.phase_started_at,
			        s.updated_at, s.completed_at, s.created_at,
			        (SELECT COUNT(*) FROM clicks c WHERE c.pid = s.pid) AS clicks,
			        (SELECT COUNT(DISTINCT seq) FROM sa_responses r WHERE r.pid = s.pid) AS sa_answered,
			        json_array_length(s.sa_plan) AS sa_total,
			        (SELECT COUNT(*) FROM phases p WHERE p.pid = s.pid AND p.phase LIKE '%.resume') AS reloads
			 FROM sessions s ORDER BY s.updated_at DESC`
		)
		.all() as any[];
	// Survey and bout answers, for correcting them on the admin page.
	const surveys = Object.fromEntries(
		(db.prepare('SELECT pid, age, exercise_days, fitness, hours_slept FROM survey').all() as any[]).map(({ pid, ...v }) => [pid, v])
	) as Record<string, { age: number; exercise_days: number; fitness: number; hours_slept: number }>;
	const bouts: Record<string, Record<string, { rpe: number; peak_hr: number | null }>> = {};
	for (const b of db.prepare('SELECT pid, bout, rpe, peak_hr FROM bouts').all() as any[]) (bouts[b.pid] ??= {})[b.bout] = { rpe: b.rpe, peak_hr: b.peak_hr };
	const edits = db.prepare('SELECT pid, field, old_value, new_value, server_ts FROM edits ORDER BY id').all() as {
		pid: string;
		field: string;
		old_value: string | null;
		new_value: string | null;
		server_ts: number;
	}[];
	const schedule = loadSchedule();
	const started = new Set(sessions.map((s) => s.pid));
	// Straps heard from in the last minute (latest reading each), for the live panel.
	const straps = db
		.prepare(
			`SELECT h.strap, h.strap_name, h.pid, h.bpm, h.contact, h.ts FROM hr_samples h
			 JOIN (SELECT strap, MAX(ts) AS ts FROM hr_samples WHERE ts > ? GROUP BY strap) l ON l.strap = h.strap AND l.ts = h.ts
			 ORDER BY h.strap_name`
		)
		.all(Date.now() - 60_000) as { strap: string; strap_name: string | null; pid: string | null; bpm: number; contact: number | null; ts: number }[];
	return {
		now: Date.now(),
		active: sessions.filter((s) => s.phase !== 'done'),
		sessions,
		surveys,
		bouts,
		edits,
		schedule: schedule.map((r) => ({ ...r, started: started.has(r.pid) })),
		straps,
		devTimers: experiment().devTimers,
		conditions: experiment().config.conditions,
		test: {
			conditions: experiment().config.conditions,
			themeOrders: experiment().config.theme_orders,
			phases: PHASES
		}
	};
}

/** Everything recorded for one participant, for the data explorer. */
export function participantDetail(pid: string) {
	const db = getDb();
	const exp = experiment();
	const session = db.prepare('SELECT * FROM sessions WHERE pid = ?').get(pid) as Record<string, any> | undefined;
	if (!session) return null;
	const rows = (sql: string) => db.prepare(sql).all(pid) as any[];
	const themes = [exp.config.practice_board.theme, session.board_a_theme, session.board_b_theme];
	return {
		session: { ...session, sa_plan: undefined },
		phases: rows('SELECT phase, started_at, ended_at, client_started_at FROM phases WHERE pid = ? ORDER BY id'),
		clicks: rows('SELECT board, seq, card_index, object_id, outcome, client_ts FROM clicks WHERE pid = ? ORDER BY board, seq'),
		sa: rescore(
			rows(
				`SELECT seq, board, theme, question_type, item, target, response, correct, confidence, rt_ms
				 FROM sa_responses WHERE pid = ? ORDER BY seq, id`
			)
		),
		bouts: rows('SELECT bout, rpe, peak_hr, server_ts FROM bouts WHERE pid = ? ORDER BY bout'),
		edits: rows('SELECT field, old_value, new_value, server_ts FROM edits WHERE pid = ? ORDER BY id'),
		hr: rows('SELECT ts, bpm, contact FROM hr_samples WHERE pid = ? ORDER BY ts'),
		survey: (db.prepare('SELECT * FROM survey WHERE pid = ?').get(pid) as Record<string, unknown> | undefined) ?? null,
		summary: summaryRows(true).find((r) => r.pid === pid) ?? null,
		// Game A/B use this participant's own layout (older sessions: the shared one).
		layouts: {
			...Object.fromEntries(themes.map((t) => [t, exp.layouts.layouts[t]])),
			...Object.fromEntries(
				(['A', 'B'] as const).map((b) => {
					const theme = b === 'A' ? session.board_a_theme : session.board_b_theme;
					return [theme, { ...exp.layouts.layouts[theme], rows: exp.config.board.rows, cols: exp.config.board.cols, cards: sessionCards(session as Parameters<typeof sessionCards>[0], b) }];
				})
			)
		},
		manifests: Object.fromEntries(themes.map((t) => [t, exp.manifests[t]])),
		colors: exp.config.colors,
		orientations: exp.config.orientations
	};
}

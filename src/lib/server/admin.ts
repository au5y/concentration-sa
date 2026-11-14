import { error, type Cookies } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { toCsv } from '../csv';
import { buildSummary, rescoreFixedAnswers } from '../metrics';
import { PHASES } from '../types';
import { getDb, TABLES } from './db';
import { experiment } from './experiment';
import { loadSchedule } from './files';
import { sessionCards, TEST_PREFIX } from './session';

const COOKIE = 'admin_token';
/** SQL filter that leaves out admin test sessions (pid TEST-n) from exports and summaries. */
const REAL = `pid NOT LIKE '${TEST_PREFIX}%'`;

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
			if (/(_at|_ts)$/.test(k)) out[`${k}_iso`] = typeof v === 'number' && v > 1e12 ? new Date(v).toISOString() : '';
		}
		return out;
	});
}

export function tableCsv(name: string): string {
	const db = getDb();
	if (name === 'summary') return toCsv(summaryRows());
	if (!(TABLES as readonly string[]).includes(name)) error(404, 'unknown table');
	const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
	let rows = db.prepare(`SELECT * FROM ${name} WHERE ${REAL} ORDER BY rowid`).all() as Record<string, unknown>[];
	if (name === 'sa_responses') rows = rescore(rows as any[]);
	const isoRows = withIso(rows);
	const header = rows.length ? Object.keys(isoRows[0]) : cols;
	return toCsv(isoRows, header);
}

/** One summary row per participant. Test sessions are left out unless `includeTests`. */
export function summaryRows(includeTests = false): Record<string, unknown>[] {
	const db = getDb();
	const exp = experiment();
	const where = includeTests ? '1 = 1' : REAL;
	const all = (sql: string) => db.prepare(sql).all() as any[];
	const layouts = Object.fromEntries(Object.entries(exp.layouts.layouts).map(([t, l]) => [t, l.cards]));
	return buildSummary({
		sessions: all(`SELECT * FROM sessions WHERE ${where} ORDER BY pid`),
		phases: all(`SELECT pid, phase, client_started_at FROM phases WHERE ${where} ORDER BY id`),
		clicks: all(`SELECT pid, board, seq, card_index, object_id, outcome, client_ts FROM clicks WHERE ${where}`),
		sa: rescore(all(`SELECT pid, board, theme, item, question_type, target, response, correct, confidence FROM sa_responses WHERE ${where}`)),
		survey: all(`SELECT * FROM survey WHERE ${where}`),
		bouts: all(`SELECT pid, bout, rpe, peak_hr FROM bouts WHERE ${where}`),
		layouts,
		saTypes: [...exp.config.sa_questions, ...level2Types(), ...(exp.config.oral_sa_questions?.length ? ['oral'] : [])]
	});
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
			`SELECT s.pid, s.condition, s.board_a_theme, s.board_b_theme, s.phase, s.phase_started_at,
			        s.updated_at, s.completed_at, s.created_at,
			        (SELECT COUNT(*) FROM clicks c WHERE c.pid = s.pid) AS clicks,
			        (SELECT COUNT(DISTINCT seq) FROM sa_responses r WHERE r.pid = s.pid) AS sa_answered,
			        json_array_length(s.sa_plan) AS sa_total,
			        (SELECT COUNT(*) FROM phases p WHERE p.pid = s.pid AND p.phase LIKE '%.resume') AS reloads
			 FROM sessions s ORDER BY s.updated_at DESC`
		)
		.all() as any[];
	const schedule = loadSchedule();
	const started = new Set(sessions.map((s) => s.pid));
	return {
		now: Date.now(),
		active: sessions.filter((s) => s.phase !== 'done'),
		sessions,
		schedule: schedule.map((r) => ({ ...r, started: started.has(r.pid) })),
		devTimers: experiment().devTimers,
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

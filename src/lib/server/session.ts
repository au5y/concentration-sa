import { error } from '@sveltejs/kit';
import { computeBoardMetrics } from '../metrics';
import { hashString, mulberry32 } from '../rng';
import { buildSaPlan, type SaStep } from '../sa-plan';
import type { SessionState } from '../state';
import { COLOR_BLIND, DONT_REMEMBER, FACILITATOR_PHASES, LEVEL2_NEUTRAL_HEX, ORAL_RESPONSES, PHASES, type ClickOutcome, type ClickRecord, type Phase } from '../types';
import { getDb } from './db';
import { experiment, timers } from './experiment';
import { loadSchedule } from './files';

export interface SessionRow {
	pid: string;
	condition: string;
	board_a_theme: string;
	board_b_theme: string;
	schedule_seed: number;
	phase: Phase;
	phase_started_at: number;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
	dev_timers: number;
	sa_plan: string;
}

const BOARD_OF: Partial<Record<Phase, 'A' | 'B'>> = { board_a: 'A', board_b: 'B' };
const MARKERS: Partial<Record<Phase, string[]>> = {
	baseline: ['start'],
	practice: ['preview', 'play', 'timeout'],
	board_a: ['preview', 'play', 'timeout'],
	board_b: ['preview', 'play', 'timeout']
};
/** Allowance for network delay and clock drift when checking a board's time limit on the server. */
const TIME_LIMIT_SLACK_MS = 5000;

export function getSession(pid: string): SessionRow | undefined {
	return getDb().prepare('SELECT * FROM sessions WHERE pid = ?').get(pid) as SessionRow | undefined;
}

function requireSession(pid: string): SessionRow {
	const s = getSession(pid);
	if (!s) error(404, `No session for ${pid}`);
	return s;
}

function insertPhase(pid: string, phase: string, now: number, clientTs: number | null) {
	getDb().prepare('INSERT INTO phases (pid, phase, started_at, client_started_at) VALUES (?, ?, ?, ?)').run(pid, phase, now, clientTs);
}

/** Create the session on first visit (from the schedule), or resume it. */
export function openSession(pid: string): SessionRow {
	const db = getDb();
	const exp = experiment();
	const existing = getSession(pid);
	const now = Date.now();
	if (existing) {
		// A reload in the middle of a board is recorded so it can be excluded or flagged.
		if (BOARD_OF[existing.phase] && hasMarker(pid, `${existing.phase}.play`)) {
			insertPhase(pid, `${existing.phase}.resume`, now, null);
		}
		return existing;
	}

	const row = loadSchedule().find((r) => r.pid === pid);
	if (!row) error(404, `Participant ${pid} is not in the schedule. Generate it with "npm run schedule".`);
	for (const t of [row.board_a_theme, row.board_b_theme]) {
		if (!exp.manifests[t]) error(500, `Schedule uses theme "${t}" which is not in the config`);
	}
	if (!exp.config.conditions.includes(row.condition)) error(500, `Unknown condition "${row.condition}" in schedule`);

	const plan = makePlan(pid, row);
	db.transaction(() => {
		db.prepare(
			`INSERT INTO sessions (pid, condition, board_a_theme, board_b_theme, schedule_seed, phase,
			 phase_started_at, created_at, updated_at, dev_timers, sa_plan) VALUES (?, ?, ?, ?, ?, 'baseline', ?, ?, ?, ?, ?)`
		).run(pid, row.condition, row.board_a_theme, row.board_b_theme, row.seed, now, now, now, exp.devTimers ? 1 : 0, JSON.stringify(plan));
		insertPhase(pid, 'baseline', now, null);
	})();
	return getSession(pid)!;
}

function makePlan(pid: string, row: { seed: number; board_a_theme: string; board_b_theme: string }): SaStep[] {
	const { config, manifests } = experiment();
	return buildSaPlan(
		[
			{ board: 'A', theme: row.board_a_theme },
			{ board: 'B', theme: row.board_b_theme }
		],
		manifests,
		config.sa_questions,
		mulberry32(hashString(`${pid}:${row.seed}:sa`)),
		config.sa_random_per_theme,
		config.sa_foils_per_theme,
		(config.oral_sa_questions ?? []).map((q) => q.id),
		{ questions: config.sa_level2_questions ?? {}, rand: mulberry32(hashString(`${pid}:${row.seed}:sa-level2`)) }
	);
}

/** Test sessions are created from /admin, never come from the schedule and are left out of exports. */
export const TEST_PREFIX = 'TEST-';
export const isTestPid = (pid: string) => pid.startsWith(TEST_PREFIX);

/** Create a throwaway test session that starts in any phase. Returns its pid. */
export function createTestSession(o: { condition: string; board_a_theme: string; board_b_theme: string; phase: Phase; fast: boolean }): string {
	const db = getDb();
	const exp = experiment();
	if (!exp.config.conditions.includes(o.condition)) error(400, `Unknown condition "${o.condition}"`);
	for (const t of [o.board_a_theme, o.board_b_theme]) if (!exp.manifests[t]) error(400, `Unknown theme "${t}"`);
	if (!PHASES.includes(o.phase)) error(400, 'bad phase');
	const rows = db.prepare('SELECT pid FROM sessions WHERE pid LIKE ?').all(`${TEST_PREFIX}%`) as { pid: string }[];
	const n = Math.max(0, ...rows.map((r) => Number(r.pid.slice(TEST_PREFIX.length)) || 0)) + 1;
	const pid = `${TEST_PREFIX}${n}`;
	const row = { ...o, seed: Math.floor(Math.random() * 2 ** 31) };
	const now = Date.now();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO sessions (pid, condition, board_a_theme, board_b_theme, schedule_seed, phase,
			 phase_started_at, created_at, updated_at, dev_timers, sa_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(pid, o.condition, o.board_a_theme, o.board_b_theme, row.seed, o.phase, now, now, now, o.fast ? 1 : 0, JSON.stringify(makePlan(pid, row)));
		insertPhase(pid, o.phase, now, null);
	})();
	return pid;
}

/**
 * Move a test session to any phase (forward or back). Data recorded in that phase and
 * later ones is cleared so the phase starts fresh.
 */
export function jumpTestSession(pid: string, phase: Phase, fast?: boolean): SessionRow {
	if (!isTestPid(pid)) error(403, 'Only test sessions can jump between phases');
	if (!PHASES.includes(phase)) error(400, 'bad phase');
	const db = getDb();
	return db.transaction(() => {
		requireSession(pid);
		const at = PHASES.indexOf(phase);
		const del = (sql: string) => db.prepare(sql).run(pid);
		if (at <= PHASES.indexOf('board_a')) del("DELETE FROM clicks WHERE pid = ? AND board = 'A'");
		if (at <= PHASES.indexOf('board_b')) del("DELETE FROM clicks WHERE pid = ? AND board = 'B'");
		if (at <= PHASES.indexOf('sa')) del('DELETE FROM sa_responses WHERE pid = ?');
		if (at <= PHASES.indexOf('survey')) del('DELETE FROM survey WHERE pid = ?');
		if (at <= PHASES.indexOf('interval1')) del("DELETE FROM bouts WHERE pid = ? AND bout = 'interval1'");
		if (at <= PHASES.indexOf('interval2')) del("DELETE FROM bouts WHERE pid = ? AND bout = 'interval2'");
		// Drop markers of the target and later phases so e.g. a board starts at its preview again.
		for (const p of PHASES.slice(at)) db.prepare('DELETE FROM phases WHERE pid = ? AND (phase = ? OR phase LIKE ?)').run(pid, p, `${p}.%`);
		const now = Date.now();
		db.prepare('UPDATE phases SET ended_at = ? WHERE pid = ? AND ended_at IS NULL').run(now, pid);
		insertPhase(pid, phase, now, null);
		db.prepare('UPDATE sessions SET phase = ?, phase_started_at = ?, updated_at = ?, completed_at = ? WHERE pid = ?').run(
			phase, now, now, phase === 'done' ? now : null, pid
		);
		if (fast !== undefined) db.prepare('UPDATE sessions SET dev_timers = ? WHERE pid = ?').run(fast ? 1 : 0, pid);
		return getSession(pid)!;
	})();
}

function hasMarker(pid: string, name: string): boolean {
	return !!getDb().prepare('SELECT 1 FROM phases WHERE pid = ? AND phase = ? LIMIT 1').get(pid, name);
}

/** Server time of the latest marker with this name, or null. */
function markerAt(pid: string, name: string): number | null {
	const r = getDb().prepare('SELECT MAX(started_at) AS at FROM phases WHERE pid = ? AND phase = ?').get(pid, name) as { at: number | null };
	return r.at;
}

/** True once the board's play time (from its latest `.play` marker) has run out, allowing for slack. */
function timeLimitReached(s: SessionRow, phase: Phase, now: number): boolean {
	const limit = timers(experiment(), !!s.dev_timers).time_limit_ms;
	const play = markerAt(s.pid, `${phase}.play`);
	return limit > 0 && play !== null && now - play >= limit - TIME_LIMIT_SLACK_MS;
}

function boardClicks(pid: string, board: string): ClickRecord[] {
	return getDb()
		.prepare('SELECT seq, card_index, object_id, outcome, client_ts FROM clicks WHERE pid = ? AND board = ? ORDER BY seq')
		.all(pid, board) as ClickRecord[];
}

function saAnswered(pid: string): number {
	const r = getDb().prepare('SELECT COUNT(DISTINCT seq) AS n FROM sa_responses WHERE pid = ?').get(pid) as { n: number };
	return r.n;
}

function boardCards(theme: string): string[] {
	return experiment().layouts.layouts[theme].cards;
}

export function buildState(s: SessionRow): SessionState {
	const exp = experiment();
	const { config } = exp;
	const practiceTheme = config.practice_board.theme;
	const board = (key: 'practice' | 'A' | 'B', theme: string) => ({ key, theme, ...exp.layouts.layouts[theme] });
	const markerRows = getDb()
		.prepare('SELECT phase, started_at FROM phases WHERE pid = ? AND phase LIKE ? ORDER BY id')
		.all(s.pid, `${s.phase}.%`) as { phase: string; started_at: number }[];
	const b = BOARD_OF[s.phase];
	return {
		pid: s.pid,
		condition: s.condition,
		phase: s.phase,
		phaseStartedAt: s.phase_started_at,
		serverNow: Date.now(),
		devTimers: exp.devTimers || !!s.dev_timers,
		isTest: isTestPid(s.pid),
		timers: timers(exp, !!s.dev_timers),
		text: config.condition_text[s.condition],
		colors: config.colors,
		orientations: config.orientations,
		confidenceScale: config.confidence_scale,
		confidenceLabels: config.confidence_labels ?? ['Not at all sure', 'Completely sure'],
		oralQuestions: config.oral_sa_questions ?? [],
		level2Hex: config.sa_level2_neutral_hex ?? LEVEL2_NEUTRAL_HEX,
		manifests: {
			[practiceTheme]: exp.manifests[practiceTheme],
			[s.board_a_theme]: exp.manifests[s.board_a_theme],
			[s.board_b_theme]: exp.manifests[s.board_b_theme]
		},
		boards: { practice: board('practice', practiceTheme), A: board('A', s.board_a_theme), B: board('B', s.board_b_theme) },
		progress: {
			markers: markerRows.map((r) => ({ name: r.phase.slice(s.phase.length + 1), at: r.started_at })),
			clicks: b ? boardClicks(s.pid, b) : [],
			saAnswered: s.phase === 'sa' ? saAnswered(s.pid) : 0,
			bout: isBout(s.phase)
				? ((getDb().prepare('SELECT rpe, peak_hr FROM bouts WHERE pid = ? AND bout = ?').get(s.pid, s.phase) as
						| { rpe: number; peak_hr: number | null }
						| undefined) ?? null)
				: null
		},
		saPlan: JSON.parse(s.sa_plan)
	};
}

/** Move from `from` to the next phase. Idempotent: advancing a phase that is already over is a no-op. */
export function advance(pid: string, from: Phase, opts: { facilitator: boolean; clientTs: number | null }): SessionRow {
	const db = getDb();
	return db.transaction(() => {
		const s = requireSession(pid);
		if (s.phase !== from) return s;
		const idx = PHASES.indexOf(from);
		if (idx < 0 || idx === PHASES.length - 1) error(400, `Cannot advance from ${from}`);
		if (FACILITATOR_PHASES.includes(from) && !opts.facilitator) error(403, `Only the facilitator can advance from ${from}`);
		const b = BOARD_OF[from];
		if (b) {
			const m = computeBoardMetrics(boardClicks(pid, b), boardCards(b === 'A' ? s.board_a_theme : s.board_b_theme), null);
			if (!m.cleared && !(hasMarker(pid, `${from}.timeout`) && timeLimitReached(s, from, Date.now()))) {
				error(409, 'Board is not cleared yet');
			}
		}
		if (from === 'sa') {
			const plan: SaStep[] = JSON.parse(s.sa_plan);
			if (saAnswered(pid) < plan.length) error(409, 'SA questions are not finished');
		}
		if (from === 'survey' && !db.prepare('SELECT 1 FROM survey WHERE pid = ?').get(pid)) error(409, 'Survey not submitted');

		const now = Date.now();
		const next = PHASES[idx + 1];
		db.prepare(
			'UPDATE phases SET ended_at = ?, client_ended_at = ? WHERE pid = ? AND phase = ? AND ended_at IS NULL'
		).run(now, opts.clientTs, pid, from);
		insertPhase(pid, next, now, opts.clientTs);
		db.prepare('UPDATE sessions SET phase = ?, phase_started_at = ?, updated_at = ?, completed_at = ? WHERE pid = ?').run(
			next,
			now,
			now,
			next === 'done' ? now : null,
			pid
		);
		return getSession(pid)!;
	})();
}

/** Record a timestamp marker inside the current phase (e.g. baseline START, board preview / play start). */
export function mark(pid: string, phase: Phase, name: string, clientTs: number | null): number {
	const s = requireSession(pid);
	if (s.phase !== phase) error(409, `Session is in ${s.phase}, not ${phase}`);
	if (!MARKERS[phase]?.includes(name)) error(400, `Unknown marker ${phase}.${name}`);
	const now = Date.now();
	if (name === 'timeout' && !timeLimitReached(s, phase, now)) error(409, 'The time limit has not been reached');
	insertPhase(pid, `${phase}.${name}`, now, clientTs);
	getDb().prepare('UPDATE sessions SET updated_at = ? WHERE pid = ?').run(now, pid);
	return now;
}

const OUTCOMES: ClickOutcome[] = ['first_flip', 'match', 'mismatch'];

export function recordClick(
	pid: string,
	c: { board: 'A' | 'B'; seq: number; card_index: number; outcome: ClickOutcome; client_ts: number }
): void {
	const s = requireSession(pid);
	const phase = c.board === 'A' ? 'board_a' : 'board_b';
	if (s.phase !== phase) error(409, `Session is in ${s.phase}, not ${phase}`);
	const theme = c.board === 'A' ? s.board_a_theme : s.board_b_theme;
	const cards = boardCards(theme);
	if (!Number.isInteger(c.card_index) || c.card_index < 0 || c.card_index >= cards.length) error(400, 'bad card_index');
	if (!Number.isInteger(c.seq) || c.seq < 0) error(400, 'bad seq');
	if (!OUTCOMES.includes(c.outcome)) error(400, 'bad outcome');
	if (typeof c.client_ts !== 'number') error(400, 'bad client_ts');
	const now = Date.now();
	getDb()
		.prepare(
			`INSERT OR IGNORE INTO clicks (pid, board, theme, seq, card_index, object_id, outcome, client_ts, server_ts)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(pid, c.board, theme, c.seq, c.card_index, cards[c.card_index], c.outcome, c.client_ts, now);
	getDb().prepare('UPDATE sessions SET updated_at = ? WHERE pid = ?').run(now, pid);
}

export interface SaAnswer {
	seq: number;
	/** objects: array of selected ids; color/orientation: option id; side_by_side: 'left' | 'right' */
	response: string | string[];
	confidence: number | null;
	/** shown -> final answer choice */
	rt_ms: number;
	/** shown -> final confidence choice */
	confidence_rt_ms: number | null;
	/** shown -> Submit */
	submit_rt_ms: number | null;
	answer_changes: number;
	confidence_changes: number;
	client_ts: number;
}

/** Score and store one SA step. Correctness is computed here from the plan and manifests. */
export function recordSa(pid: string, a: SaAnswer): { answered: number } {
	const db = getDb();
	const exp = experiment();
	return db.transaction(() => {
		const s = requireSession(pid);
		if (s.phase !== 'sa') error(409, `Session is in ${s.phase}, not sa`);
		const plan: SaStep[] = JSON.parse(s.sa_plan);
		const answered = saAnswered(pid);
		if (a.seq < answered) return { answered }; // duplicate retry
		if (a.seq !== answered) error(409, `Expected answer to step ${answered}`);
		const step = plan[a.seq];
		const m = exp.manifests[step.theme]; // undefined for oral (environment) steps
		const now = Date.now();
		const insert = db.prepare(
			`INSERT OR IGNORE INTO sa_responses (pid, seq, board, theme, question_type, item, target, response, correct,
			 confidence, rt_ms, confidence_rt_ms, submit_rt_ms, answer_changes, confidence_changes, presented, client_ts, server_ts)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const grid = step.type === 'objects';
		const resp = String(a.response);
		// "I don't remember" (scored incorrect) and "I'm color blind" (color and Level 2
		// color-pair only; excluded from accuracy) carry no confidence rating.
		const colorQ = step.type === 'color' || step.type === 'level2_color';
		const special = !grid && (resp === DONT_REMEMBER || (resp === COLOR_BLIND && colorQ));
		// Environment questions are marked by the facilitator: no confidence rating.
		const noConf = grid || special || step.type === 'oral';
		const row = (item: string, target: string, response: string, correct: boolean, presented: unknown) =>
			insert.run(pid, step.seq, step.board, step.theme, step.type, item, target, response, correct ? 1 : 0,
				noConf ? null : a.confidence, a.rt_ms, noConf ? null : a.confidence_rt_ms, a.submit_rt_ms,
				a.answer_changes, grid ? null : a.confidence_changes, JSON.stringify(presented), a.client_ts, now);

		const scale = exp.config.confidence_scale;
		if (!noConf && scale > 0 && (!Number.isInteger(a.confidence) || a.confidence! < 1 || a.confidence! > scale)) {
			error(400, 'confidence out of range');
		}
		if (step.type === 'objects') {
			if (!Array.isArray(a.response)) error(400, 'objects response must be a list');
			const selected = new Set(a.response);
			const seen = new Set(m.objects.map((o) => o.id));
			step.items.forEach((id, pos) => {
				const isSeen = seen.has(id);
				const sel = selected.has(id);
				row(id, isSeen ? 'seen' : 'foil', sel ? 'selected' : 'not_selected', sel === isSeen, { position: pos });
			});
		} else if (step.type === 'oral') {
			const q = (exp.config.oral_sa_questions ?? []).find((x) => x.id === step.item);
			if (!q) error(500, `oral question "${step.item}" is no longer in the config`);
			// The facilitator marks the spoken answer correct / incorrect (or "didn't remember").
			if (!special && !(ORAL_RESPONSES as readonly string[]).includes(resp)) error(400, 'oral response must be correct, incorrect or dont_remember');
			row(step.item, 'correct', resp, resp === 'correct', { prompt: q.prompt, options: q.options.map((o) => o.id), marked_by: 'facilitator' });
		} else if (step.type === 'level2_color' || step.type === 'level2_count') {
			const q = (exp.config.sa_level2_questions?.[step.theme] ?? []).find((x) => x.id === step.item);
			if (!q) error(500, `Level 2 question "${step.item}" is no longer in the config`);
			const options = step.type === 'level2_color' ? step.options : step.options.map((o) => o.id);
			if (!special && !options.includes(resp)) error(400, 'unknown option');
			const presented =
				step.type === 'level2_color'
					? { prompt: step.prompt, cue: step.cue, options, hex: exp.config.sa_level2_neutral_hex ?? LEVEL2_NEUTRAL_HEX }
					: { prompt: step.prompt, options };
			row(step.item, q.answer, resp, resp === q.answer, presented);
		} else {
			const obj = m.objects.find((o) => o.id === step.item)!;
			if (step.type === 'color') {
				if (!special && !exp.config.colors.some((c) => c.id === resp)) error(400, 'unknown color');
				row(step.item, obj.color!, resp, resp === obj.color, exp.config.colors.map((c) => c.id));
			} else if (step.type === 'orientation') {
				row(step.item, obj.orientation!, resp, resp === obj.orientation, exp.config.orientations.map((o) => o.id));
			} else if (step.type === 'side_by_side') {
				if (!special && resp !== 'left' && resp !== 'right') error(400, 'side_by_side response must be left or right');
				row(step.item, step.original_side, resp, resp === step.original_side, { original_side: step.original_side });
			}
		}
		db.prepare('UPDATE sessions SET updated_at = ? WHERE pid = ?').run(now, pid);
		return { answered: answered + 1 };
	})();
}

const isBout = (p: Phase) => p === 'interval1' || p === 'interval2';

/** Facilitator records RPE (Borg 6-20) and, optionally, peak HR at the end of an exercise/rest bout. */
export function recordBout(pid: string, v: { phase: Phase; rpe: number; peak_hr: number | null }): void {
	const s = requireSession(pid);
	if (!isBout(v.phase) || s.phase !== v.phase) error(409, `Session is in ${s.phase}, not ${v.phase}`);
	if (!Number.isInteger(v.rpe) || v.rpe < 6 || v.rpe > 20) error(400, 'RPE must be 6-20');
	if (v.peak_hr !== null && (!Number.isInteger(v.peak_hr) || v.peak_hr < 30 || v.peak_hr > 250)) error(400, 'peak HR must be 30-250 bpm');
	const now = Date.now();
	getDb()
		.prepare('INSERT OR REPLACE INTO bouts (pid, bout, rpe, peak_hr, server_ts) VALUES (?, ?, ?, ?, ?)')
		.run(pid, v.phase, v.rpe, v.peak_hr, now);
	getDb().prepare('UPDATE sessions SET updated_at = ? WHERE pid = ?').run(now, pid);
}

export interface SurveyAnswers {
	age: number;
	exercise_days: number;
	fitness: number;
	hours_slept: number;
	caffeine: string;
	color_vision: string;
}

export function recordSurvey(pid: string, v: SurveyAnswers, clientTs: number | null): SessionRow {
	const s = requireSession(pid);
	if (s.phase !== 'survey') error(409, `Session is in ${s.phase}, not survey`);
	if (!Number.isInteger(v.age) || v.age < 16 || v.age > 99) error(400, 'age must be 16-99');
	if (!Number.isInteger(v.exercise_days) || v.exercise_days < 0 || v.exercise_days > 7) error(400, 'exercise days must be 0-7');
	if (!Number.isInteger(v.fitness) || v.fitness < 1 || v.fitness > 5) error(400, 'fitness must be 1-5');
	if (typeof v.hours_slept !== 'number' || v.hours_slept < 0 || v.hours_slept > 24) error(400, 'hours slept must be 0-24');
	if (!['yes', 'no'].includes(v.caffeine)) error(400, 'caffeine must be yes/no');
	if (!['yes', 'no', 'unsure'].includes(v.color_vision)) error(400, 'color vision must be yes/no/unsure');
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO survey (pid, age, exercise_days, fitness, hours_slept, caffeine, color_vision, server_ts)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(pid, v.age, v.exercise_days, v.fitness, v.hours_slept, v.caffeine, v.color_vision, Date.now());
	return advance(pid, 'survey', { facilitator: false, clientTs });
}

/** Delete everything recorded for these participants so they can start over. */
export function deleteParticipants(pids: string[]): number {
	const db = getDb();
	return db.transaction(() => {
		let n = 0;
		for (const pid of pids) {
			for (const t of ['clicks', 'sa_responses', 'bouts', 'survey', 'phases']) db.prepare(`DELETE FROM ${t} WHERE pid = ?`).run(pid);
			n += db.prepare('DELETE FROM sessions WHERE pid = ?').run(pid).changes;
		}
		return n;
	})();
}

/** Delete all collected data (the schedule file is kept). */
export function resetAllData(): void {
	const db = getDb();
	db.transaction(() => {
		for (const t of ['clicks', 'sa_responses', 'bouts', 'survey', 'phases', 'sessions']) db.prepare(`DELETE FROM ${t}`).run();
	})();
}

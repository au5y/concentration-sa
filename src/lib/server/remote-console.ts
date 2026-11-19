/** What the facilitator's remote console (/admin/remote/<pid>) shows, and what it can do. */
import { error } from '@sveltejs/kit';
import { hasRemoteTag } from '../remote';
import type { SaStep } from '../sa-plan';
import type { ClickRecord } from '../types';
import { FACILITATOR_PHASES, PHASES, type Phase } from '../types';
import { getDb } from './db';
import { experiment, skippedPhases, timers } from './experiment';
import { remoteKey } from './remote';
import { setCondition } from './schedule';
import { abortSession, advance, getSession, jumpSession, mark, recordBout, recordSurvey, sessionCards, type SurveyAnswers } from './session';

/** Heart-rate history shown in the console. */
const HR_WINDOW_MS = 5 * 60_000;

export function consoleState(pid: string) {
	const db = getDb();
	const s = getSession(pid);
	if (!s) return null;
	const exp = experiment();
	const now = Date.now();
	const t = timers(exp, !!s.dev_timers);
	const markers = (
		db.prepare('SELECT phase, started_at FROM phases WHERE pid = ? AND phase LIKE ? ORDER BY id').all(pid, `${s.phase}.%`) as {
			phase: string;
			started_at: number;
		}[]
	).map((r) => ({ name: r.phase.slice(s.phase.length + 1), at: r.started_at }));
	const board = s.phase === 'board_a' ? 'A' : s.phase === 'board_b' ? 'B' : null;
	let boardProgress: { pairs: number; total: number; clicks: number } | null = null;
	/** The board being played, for the read-only live view. */
	let live: { key: 'A' | 'B'; theme: string; cols: number; cards: string[]; clicks: ClickRecord[] } | null = null;
	if (board) {
		const clicks = db
			.prepare('SELECT seq, card_index, object_id, outcome, client_ts FROM clicks WHERE pid = ? AND board = ? ORDER BY seq')
			.all(pid, board) as ClickRecord[];
		const cards = sessionCards(s, board);
		boardProgress = {
			pairs: clicks.filter((c) => c.outcome === 'match').length,
			total: cards.length / 2,
			clicks: clicks.length
		};
		live = { key: board, theme: board === 'A' ? s.board_a_theme : s.board_b_theme, cols: exp.config.board.cols, cards, clicks };
	}
	// Boards they have finished (cleared, or time ran out), for the console's "board done" alert.
	const practiceEnd = s.phase === 'practice' ? markers.find((m) => m.name === 'cleared' || m.name === 'timeout') : undefined;
	const boardsDone: { key: 'practice' | 'A' | 'B'; phase: string; endedAt: number; pairs: number | null; total: number | null; clicks: number | null; cleared: boolean }[] =
		practiceEnd ? [{ key: 'practice', phase: 'practice', endedAt: practiceEnd.at, pairs: null, total: null, clicks: null, cleared: practiceEnd.name === 'cleared' }] : [];
	boardsDone.push(...(['A', 'B'] as const).flatMap((key) => {
		const phase = key === 'A' ? 'board_a' : 'board_b';
		const row = db.prepare('SELECT ended_at FROM phases WHERE pid = ? AND phase = ? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(pid, phase) as
			| { ended_at: number }
			| undefined;
		if (!row || PHASES.indexOf(s.phase) <= PHASES.indexOf(phase) || s.aborted_at) return [];
		const outcomes = db.prepare('SELECT outcome FROM clicks WHERE pid = ? AND board = ?').all(pid, key) as { outcome: string }[];
		const pairs = outcomes.filter((c) => c.outcome === 'match').length;
		const total = sessionCards(s, key).length / 2;
		return [{ key, phase, endedAt: row.ended_at, pairs, total, clicks: outcomes.length, cleared: pairs >= total }];
	}));
	const plan: SaStep[] = JSON.parse(s.sa_plan);
	const saAnswered = (db.prepare('SELECT COUNT(DISTINCT seq) AS n FROM sa_responses WHERE pid = ?').get(pid) as { n: number }).n;
	const hr = db
		.prepare('SELECT ts, bpm, contact FROM hr_samples WHERE pid = ? AND ts > ? ORDER BY ts')
		.all(pid, now - HR_WINDOW_MS) as { ts: number; bpm: number; contact: number | null }[];
	// Peak HR in the current exercise/rest bout (from its Start), to prefill the RPE form.
	const start = markers.find((m) => m.name === 'start')?.at ?? s.phase_started_at;
	const isBout = s.phase === 'interval1' || s.phase === 'interval2';
	const peak = isBout
		? (db.prepare('SELECT MAX(bpm) AS m FROM hr_samples WHERE pid = ? AND ts >= ? AND (contact IS NULL OR contact = 1)').get(pid, start) as { m: number | null }).m
		: null;
	const bout = isBout
		? ((db.prepare('SELECT rpe, peak_hr FROM bouts WHERE pid = ? AND bout = ?').get(pid, s.phase) as { rpe: number; peak_hr: number | null } | undefined) ?? null)
		: null;
	return {
		now,
		pid,
		remote: hasRemoteTag(s.tags),
		key: hasRemoteTag(s.tags) ? remoteKey(pid) : null,
		condition: s.condition,
		conditions: exp.config.conditions,
		tags: s.tags,
		board_a_theme: s.board_a_theme,
		board_b_theme: s.board_b_theme,
		phase: s.phase,
		phases: PHASES,
		/** Phases this condition leaves out (config.skip_phases). */
		skipped: skippedPhases(exp, s.condition),
		facilitatorPhases: FACILITATOR_PHASES,
		phaseStartedAt: s.phase_started_at,
		updatedAt: s.updated_at,
		abortedAt: s.aborted_at,
		abortReason: s.abort_reason,
		markers,
		timers: t,
		recordRpe: !exp.config.rpe_conditions || exp.config.rpe_conditions.includes(s.condition),
		bout,
		peak,
		boardProgress,
		boardsDone,
		live,
		manifest: live ? exp.manifests[live.theme] : null,
		colors: exp.config.colors,
		orientations: exp.config.orientations,
		survey: (db.prepare('SELECT age, exercise_days, fitness, hours_slept FROM survey WHERE pid = ?').get(pid) as SurveyAnswers | undefined) ?? null,
		bouts: db.prepare('SELECT bout, rpe, peak_hr FROM bouts WHERE pid = ? ORDER BY bout').all(pid) as { bout: string; rpe: number; peak_hr: number | null }[],
		answers: db
			.prepare(
				`SELECT seq, board, theme, question_type, item, target, response, correct, confidence, rt_ms
				 FROM sa_responses WHERE pid = ? ORDER BY seq, id`
			)
			.all(pid) as { seq: number; board: string; theme: string; question_type: string; item: string; target: string; response: string; correct: number; confidence: number | null; rt_ms: number | null }[],
		sa: { answered: saAnswered, total: plan.length },
		hr
	};
}

/** Facilitator actions from the console. */
export function consoleAction(pid: string, b: Record<string, unknown>) {
	const s = getSession(pid);
	if (!s) error(404, `No session for ${pid}`);
	if (b.action === 'abort') return abortSession(pid, typeof b.reason === 'string' ? b.reason : '');
	// Admin override: any phase, forward or back (restart phase / from the beginning / skip / resume).
	if (b.action === 'jump') return jumpSession(pid, b.to as Phase);
	if (b.action === 'condition') return setCondition(pid, String(b.condition));
	const phase = b.phase as Phase;
	if (phase !== s.phase) error(409, `${pid} is now in ${s.phase}, not ${String(b.phase)}; the page will refresh`);
	if (b.action === 'advance') return advance(pid, phase, { facilitator: true, clientTs: null });
	if (b.action === 'start') return mark(pid, phase, 'start', null);
	if (b.action === 'skip') {
		// No resting baseline (e.g. no strap): leave a "baseline.skipped" marker in the data, then move on.
		if (phase !== 'baseline') error(400, 'Only the baseline can be skipped');
		mark(pid, phase, 'skipped', null);
		return advance(pid, phase, { facilitator: true, clientTs: null });
	}
	if (b.action === 'survey') {
		const v = (b.answers ?? {}) as Record<string, unknown>;
		return recordSurvey(pid, { age: Number(v.age), exercise_days: Number(v.exercise_days), fitness: Number(v.fitness), hours_slept: Number(v.hours_slept) }, null);
	}
	if (b.action === 'bout') {
		recordBout(pid, { phase, rpe: Number(b.rpe), peak_hr: typeof b.peak_hr === 'number' ? b.peak_hr : null });
		return { ok: true };
	}
	error(400, 'unknown action');
}

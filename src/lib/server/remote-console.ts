/** What the facilitator's remote console (/admin/remote/<pid>) shows, and what it can do. */
import { error } from '@sveltejs/kit';
import { hasRemoteTag } from '../remote';
import type { SaStep } from '../sa-plan';
import type { ClickRecord } from '../types';
import { FACILITATOR_PHASES, PHASES, type Phase } from '../types';
import { getDb } from './db';
import { experiment, timers } from './experiment';
import { remoteKey } from './remote';
import { advance, getSession, mark, recordBout, sessionCards } from './session';

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
	}
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
		tags: s.tags,
		board_a_theme: s.board_a_theme,
		board_b_theme: s.board_b_theme,
		phase: s.phase,
		phases: PHASES,
		facilitatorPhases: FACILITATOR_PHASES,
		phaseStartedAt: s.phase_started_at,
		updatedAt: s.updated_at,
		markers,
		timers: t,
		recordRpe: !exp.config.rpe_conditions || exp.config.rpe_conditions.includes(s.condition),
		bout,
		peak,
		boardProgress,
		survey: !!db.prepare('SELECT 1 FROM survey WHERE pid = ?').get(pid),
		sa: { answered: saAnswered, total: plan.length },
		hr
	};
}

/** Facilitator actions from the console. */
export function consoleAction(pid: string, b: Record<string, unknown>) {
	const s = getSession(pid);
	if (!s) error(404, `No session for ${pid}`);
	const phase = b.phase as Phase;
	if (phase !== s.phase) error(409, `${pid} is now in ${s.phase}, not ${String(b.phase)}; the page will refresh`);
	if (b.action === 'advance') return advance(pid, phase, { facilitator: true, clientTs: null });
	if (b.action === 'start') return mark(pid, phase, 'start', null);
	if (b.action === 'bout') {
		recordBout(pid, { phase, rpe: Number(b.rpe), peak_hr: typeof b.peak_hr === 'number' ? b.peak_hr : null });
		return { ok: true };
	}
	error(400, 'unknown action');
}

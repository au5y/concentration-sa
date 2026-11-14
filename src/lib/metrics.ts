import type { ClickRecord, Level2Question } from './types';

export interface BoardMetrics {
	cleared: boolean;
	pairs_found: number;
	/** Last match minus the moment cards flipped face down (client clock, ms). */
	time_to_clear_ms: number | null;
	total_flips: number;
	/** A move is a completed pair of flips (match or mismatch). */
	moves: number;
	/** pairs found / moves */
	efficiency: number | null;
	/** Mismatched pairs of flips (errors per game). */
	mismatches: number;
	/** Mismatch where the second card's location had already been revealed in an earlier move. */
	repeat_errors: number;
	/** Mismatch where the first card's partner had already been revealed in an earlier move. */
	missed_matches: number;
}

/**
 * Compute matching-game metrics from the click log of one board.
 * `cards` is the board layout (object id per card index).
 */
export function computeBoardMetrics(
	clicks: ClickRecord[],
	cards: string[],
	playStartTs: number | null
): BoardMetrics {
	const sorted = clicks.slice().sort((a, b) => a.seq - b.seq);
	const partner = (idx: number) => cards.findIndex((id, j) => j !== idx && id === cards[idx]);
	const revealed = new Set<number>();
	const matched = new Set<number>();
	let pending: ClickRecord | null = null;
	let moves = 0;
	let repeat = 0;
	let missed = 0;
	let mismatches = 0;
	let lastMatchTs: number | null = null;

	for (const c of sorted) {
		if (c.outcome === 'first_flip') {
			// A dangling first flip (e.g. page reloaded mid-move) is still revealed.
			if (pending) revealed.add(pending.card_index);
			pending = c;
			continue;
		}
		moves++;
		if (c.outcome === 'mismatch') {
			mismatches++;
			if (revealed.has(c.card_index)) repeat++;
			if (pending && revealed.has(partner(pending.card_index))) missed++;
		} else {
			matched.add(c.card_index);
			if (pending) matched.add(pending.card_index);
			lastMatchTs = c.client_ts;
		}
		revealed.add(c.card_index);
		if (pending) revealed.add(pending.card_index);
		pending = null;
	}

	const pairsFound = matched.size / 2;
	const cleared = cards.length > 0 && matched.size === cards.length;
	return {
		cleared,
		pairs_found: pairsFound,
		time_to_clear_ms: cleared && lastMatchTs !== null && playStartTs !== null ? lastMatchTs - playStartTs : null,
		total_flips: sorted.length,
		moves,
		efficiency: moves > 0 ? pairsFound / moves : null,
		mismatches,
		repeat_errors: repeat,
		missed_matches: missed
	};
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.15e-9). */
export function normInv(p: number): number {
	if (p <= 0 || p >= 1) throw new RangeError('p must be in (0, 1)');
	const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
	const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
	const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
	const lo = 0.02425;
	if (p < lo) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	if (p > 1 - lo) return -normInv(1 - p);
	const q = p - 0.5;
	const r = q * q;
	return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * d' = z(H) - z(F) with the log-linear correction (Hautus, 1995):
 * H = (hits + 0.5) / (targets + 1), F = (false alarms + 0.5) / (foils + 1).
 */
export function dPrime(hits: number, targets: number, falseAlarms: number, foils: number): number | null {
	if (targets <= 0 || foils <= 0) return null;
	const h = (hits + 0.5) / (targets + 1);
	const f = (falseAlarms + 0.5) / (foils + 1);
	return normInv(h) - normInv(f);
}

// ---------------------------------------------------------------------------
// Per-participant summary

export interface SummaryInput {
	sessions: {
		pid: string;
		condition: string;
		board_a_theme: string;
		board_b_theme: string;
		phase: string;
		completed_at: number | null;
		/** This participant's layouts, JSON {A: cards, B: cards}; null/absent = the shared layout. */
		layouts?: string | null;
	}[];
	phases: { pid: string; phase: string; client_started_at: number | null }[];
	clicks: (ClickRecord & { pid: string; board: string })[];
	sa: {
		pid: string;
		board: string;
		theme?: string;
		item?: string;
		question_type: string;
		target: string;
		response: string;
		correct: number;
		confidence: number | null;
	}[];
	survey: {
		pid: string;
		age: number;
		exercise_days: number;
		fitness: number;
		hours_slept: number;
	}[];
	/** RPE / peak HR per exercise-rest bout (interval1 before Game A, interval2 before Game B). */
	bouts: { pid: string; bout: string; rpe: number; peak_hr: number | null }[];
	/** Shared board layout (object id per card) keyed by theme; used for sessions without their own `layouts`. */
	layouts: Record<string, string[]>;
	saTypes: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const diff = (b: number | null, a: number | null) => (a === null || b === null ? null : b - a);

const BOARD_FIELDS = ['pairs_found', 'time_to_clear_ms', 'total_flips', 'moves', 'mismatches', 'efficiency', 'repeat_errors', 'missed_matches'] as const;

/**
 * Question categories for the analysis: memory = Level 1 card questions; level2 = Level 2
 * (comprehension) card questions; sa_env = environment questions read aloud.
 */
export const QUESTION_GROUPS: Record<string, string[]> = {
	memory: ['color', 'orientation', 'side_by_side'],
	level2: ['level2_color', 'level2_count'],
	sa_env: ['oral']
};
/** Question types that need color vision. */
export const COLOR_TYPES = ['color', 'level2_color'];

/**
 * Re-score Level 2 questions against the current config, so a corrected answer applies to
 * every session. Rows whose question is no longer in the config keep their stored score.
 * (Environment questions are marked correct/incorrect by the facilitator and are left as is.)
 */
export function rescoreFixedAnswers<
	T extends { question_type: string; theme?: string; item?: string; target: string; response: string; correct: number }
>(rows: T[], level2: Record<string, Level2Question[]> = {}): T[] {
	return rows.map((r) => {
		if (!r.question_type.startsWith('level2_')) return r;
		const answer = level2[r.theme ?? '']?.find((q) => q.id === r.item)?.answer;
		if (answer === undefined) return r;
		return { ...r, target: answer, correct: r.response === answer ? 1 : 0 };
	});
}
const DONT_REMEMBER = 'dont_remember';

export function buildSummary(input: SummaryInput): Record<string, unknown>[] {
	return input.sessions.map((s) => {
		const row: Record<string, unknown> = {
			pid: s.pid,
			condition: s.condition,
			board_a_theme: s.board_a_theme,
			board_b_theme: s.board_b_theme,
			final_phase: s.phase,
			completed: s.completed_at ? 1 : 0
		};

		const boardMetrics: Record<string, BoardMetrics> = {};
		for (const [board, theme] of [
			['A', s.board_a_theme],
			['B', s.board_b_theme]
		] as const) {
			const key = board === 'A' ? 'board_a' : 'board_b';
			const play = input.phases.find((p) => p.pid === s.pid && p.phase === `${key}.play`);
			const clicks = input.clicks.filter((c) => c.pid === s.pid && c.board === board);
			const own = s.layouts ? (JSON.parse(s.layouts) as Record<string, string[]>)[board] : undefined;
			const m = computeBoardMetrics(clicks, own ?? input.layouts[theme] ?? [], play?.client_started_at ?? null);
			boardMetrics[board] = m;
			row[`${board}_cleared`] = m.cleared ? 1 : 0;
			row[`${board}_timed_out`] = input.phases.some((p) => p.pid === s.pid && p.phase === `${key}.timeout`) ? 1 : 0;
			for (const f of BOARD_FIELDS) row[`${board}_${f}`] = m[f];
			row[`${board}_reloads`] = input.phases.filter((p) => p.pid === s.pid && p.phase === `${key}.resume`).length;
		}
		for (const f of BOARD_FIELDS) row[`delta_BminusA_${f}`] = diff(boardMetrics.B[f], boardMetrics.A[f]);

		// "I don't remember" counts as incorrect.
		const sa = input.sa.filter((r) => r.pid === s.pid);
		for (const type of input.saTypes) {
			for (const scope of ['all', 'A', 'B']) {
				if (type === 'oral' && scope !== 'all') continue;
				const rows = sa.filter((r) => r.question_type === type && (scope === 'all' || r.board === scope));
				const suffix = scope === 'all' ? '' : `_${scope}`;
				row[`q_${type}_acc${suffix}`] = mean(rows.map((r) => r.correct));
				if (type !== 'objects') {
					const conf = rows.map((r) => r.confidence).filter((c): c is number => c !== null);
					row[`q_${type}_conf${suffix}`] = mean(conf);
				} else {
					const targets = rows.filter((r) => r.target === 'seen');
					const foils = rows.filter((r) => r.target === 'foil');
					const hits = targets.filter((r) => r.response === 'selected').length;
					const fas = foils.filter((r) => r.response === 'selected').length;
					row[`q_objects_hit_rate${suffix}`] = targets.length ? hits / targets.length : null;
					row[`q_objects_fa_rate${suffix}`] = foils.length ? fas / foils.length : null;
					row[`q_objects_dprime${suffix}`] = dPrime(hits, targets.length, fas, foils.length);
				}
			}
		}
		// Memory vs SA (the Question Type factor). acc counts "I don't remember" as incorrect;
		// acc_known is the sensitivity version that leaves those answers out.
		for (const [group, types] of Object.entries(QUESTION_GROUPS)) {
			const rows = sa.filter((r) => types.includes(r.question_type));
			const known = rows.filter((r) => r.response !== DONT_REMEMBER);
			row[`${group}_n`] = rows.length;
			row[`${group}_acc`] = mean(rows.map((r) => r.correct));
			row[`${group}_acc_known`] = mean(known.map((r) => r.correct));
			row[`${group}_dont_remember_rate`] = rows.length ? (rows.length - known.length) / rows.length : null;
			row[`${group}_conf`] = mean(known.map((r) => r.confidence).filter((c): c is number => c !== null));
		}
		// Level 2 accuracy without the color-pair questions, for color-blind participants.
		const l2NoColor = sa.filter((r) => QUESTION_GROUPS.level2.includes(r.question_type) && !COLOR_TYPES.includes(r.question_type));
		row.level2_acc_excl_color = mean(l2NoColor.map((r) => r.correct));

		const sv = input.survey.find((r) => r.pid === s.pid);
		row.age = sv?.age ?? null;
		row.exercise_days = sv?.exercise_days ?? null;
		row.fitness = sv?.fitness ?? null;
		row.hours_slept = sv?.hours_slept ?? null;
		// Manipulation check: bout 1 = before Game A (long bout), bout 2 = before Game B.
		const hrMax = sv?.age ? 220 - sv.age : null;
		for (const [n, bout] of [
			[1, 'interval1'],
			[2, 'interval2']
		] as const) {
			const b = input.bouts.find((r) => r.pid === s.pid && r.bout === bout);
			row[`rpe_${n}`] = b?.rpe ?? null;
			row[`peak_hr_${n}`] = b?.peak_hr ?? null;
			row[`pct_hrmax_${n}`] = b?.peak_hr && hrMax ? b.peak_hr / hrMax : null;
		}
		return row;
	});
}

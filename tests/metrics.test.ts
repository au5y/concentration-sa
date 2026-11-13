import { describe, expect, it } from 'vitest';
import { buildSummary, computeBoardMetrics, dPrime, normInv } from '../src/lib/metrics';
import type { ClickOutcome, ClickRecord } from '../src/lib/types';

// 2x2 board: cards 0,3 = x ; 1,2 = y
const cards2 = ['x', 'y', 'y', 'x'];

function seqOf(moves: [number, number][], cards: string[], t0 = 1000, dt = 100): ClickRecord[] {
	const out: ClickRecord[] = [];
	let seq = 0;
	let t = t0;
	const matched = new Set<number>();
	for (const [a, b] of moves) {
		out.push({ seq: seq++, card_index: a, object_id: cards[a], outcome: 'first_flip', client_ts: (t += dt) });
		const outcome: ClickOutcome = cards[a] === cards[b] ? 'match' : 'mismatch';
		if (outcome === 'match') matched.add(a).add(b);
		out.push({ seq: seq++, card_index: b, object_id: cards[b], outcome, client_ts: (t += dt) });
	}
	return out;
}

describe('computeBoardMetrics', () => {
	it('perfect play: efficiency 1, no errors', () => {
		const m = computeBoardMetrics(seqOf([[0, 3], [1, 2]], cards2), cards2, 1000);
		expect(m).toMatchObject({ cleared: true, pairs_found: 2, moves: 2, total_flips: 4, efficiency: 1, repeat_errors: 0, missed_matches: 0 });
		expect(m.time_to_clear_ms).toBe(400);
	});

	it('counts a repeat error when the second card was already revealed', () => {
		// move1: 0(x) vs 1(y) mismatch -> both revealed
		// move2: 2(y) vs 0(x) mismatch: card 0 already revealed -> repeat error;
		//        first card 2's partner (1) was revealed -> missed match
		// move3: 2 vs 1 match ; move4: 0 vs 3 match
		const clicks = seqOf([[0, 1], [2, 0], [2, 1], [0, 3]], cards2);
		const m = computeBoardMetrics(clicks, cards2, 1000);
		expect(m.moves).toBe(4);
		expect(m.repeat_errors).toBe(1);
		expect(m.missed_matches).toBe(1);
		expect(m.efficiency).toBe(0.5);
		expect(m.cleared).toBe(true);
	});

	it('first-move mismatches on unseen cards are not repeat errors', () => {
		const cards = ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'];
		const m = computeBoardMetrics(seqOf([[0, 1], [2, 3]], cards), cards, 0);
		expect(m.repeat_errors).toBe(0);
		expect(m.missed_matches).toBe(0);
		expect(m.cleared).toBe(false);
		expect(m.time_to_clear_ms).toBeNull();
		expect(m.efficiency).toBe(0);
	});

	it('a mismatch whose second card was seen counts even if the first was new', () => {
		const cards = ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'];
		// move1: 0 vs 1 ; move2: 2 (new) vs 1 (seen) -> repeat error, partner of 2 (6) unseen -> no missed match
		const m = computeBoardMetrics(seqOf([[0, 1], [2, 1]], cards), cards, 0);
		expect(m.repeat_errors).toBe(1);
		expect(m.missed_matches).toBe(0);
	});

	it('ignores sequence order of input and tolerates a dangling first flip', () => {
		const clicks = seqOf([[0, 3], [1, 2]], cards2);
		const withOrphan: ClickRecord[] = [
			{ seq: 0, card_index: 1, object_id: 'y', outcome: 'first_flip' as const, client_ts: 1050 },
			...clicks.map((c) => ({ ...c, seq: c.seq + 1 }))
		].reverse();
		const m = computeBoardMetrics(withOrphan, cards2, 1000);
		expect(m.cleared).toBe(true);
		expect(m.moves).toBe(2);
		expect(m.total_flips).toBe(5);
	});

	it('missing play-start timestamp yields null time', () => {
		expect(computeBoardMetrics(seqOf([[0, 3], [1, 2]], cards2), cards2, null).time_to_clear_ms).toBeNull();
	});
});

describe('dPrime', () => {
	it('normInv matches known quantiles', () => {
		expect(normInv(0.5)).toBeCloseTo(0, 8);
		expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
		expect(normInv(0.01)).toBeCloseTo(-2.326348, 5);
	});

	it('uses the log-linear correction', () => {
		// perfect: H = 8.5/9, F = 0.5/9
		expect(dPrime(8, 8, 0, 8)).toBeCloseTo(2 * normInv(8.5 / 9), 8);
		expect(dPrime(8, 8, 0, 8)!).toBeGreaterThan(3);
		// chance performance -> 0
		expect(dPrime(4, 8, 4, 8)).toBeCloseTo(0, 8);
		expect(dPrime(6, 8, 2, 8)).toBeCloseTo(normInv(6.5 / 9) - normInv(2.5 / 9), 8);
		expect(dPrime(0, 0, 0, 8)).toBeNull();
	});
});

describe('buildSummary', () => {
	it('computes per-board metrics, B-A deltas and SA accuracy', () => {
		const A = seqOf([[0, 1], [0, 3], [1, 2]], cards2); // 3 moves
		const B = seqOf([[0, 3], [1, 2]], cards2, 5000); // 2 moves
		const sa = [
			...['x', 'y'].map((t) => ({ target: 'seen', response: 'selected' })),
			{ target: 'foil', response: 'selected' },
			{ target: 'foil', response: 'not_selected' }
		].map((r) => ({
			pid: 'P01',
			board: 'A',
			question_type: 'objects',
			...r,
			correct: (r.target === 'seen') === (r.response === 'selected') ? 1 : 0,
			confidence: null as number | null
		}));
		sa.push({ pid: 'P01', board: 'B', question_type: 'color', target: 'red', response: 'red', correct: 1, confidence: 4 });
		sa.push({ pid: 'P01', board: 'B', question_type: 'color', target: 'red', response: 'blue', correct: 0, confidence: 2 });
		// excluded from scoring
		sa.push({ pid: 'P01', board: 'B', question_type: 'color', target: 'red', response: 'color_blind', correct: 0, confidence: null });
		sa.push({ pid: 'P01', board: 'A', question_type: 'side_by_side', target: 'left', response: 'dont_remember', correct: 0, confidence: null });
		sa.push({ pid: 'P01', board: 'env', question_type: 'oral', target: 'yes', response: 'yes', correct: 1, confidence: 3 });

		const [row] = buildSummary({
			sessions: [{ pid: 'P01', condition: 'rest', board_a_theme: 'm', board_b_theme: 't', phase: 'done', completed_at: 1 }],
			phases: [
				{ pid: 'P01', phase: 'board_a.play', client_started_at: 1000 },
				{ pid: 'P01', phase: 'board_b.play', client_started_at: 5000 }
			],
			clicks: [...A.map((c) => ({ ...c, pid: 'P01', board: 'A' })), ...B.map((c) => ({ ...c, pid: 'P01', board: 'B' }))],
			sa,
			survey: [{ pid: 'P01', age: 20, exercise_days: 3, fitness: 3, hours_slept: 7, caffeine: 'no', color_vision: 'no' }],
			bouts: [{ pid: 'P01', bout: 'interval1', rpe: 17, peak_hr: 180 }],
			layouts: { m: cards2, t: cards2 },
			saTypes: ['objects', 'color', 'side_by_side', 'oral']
		});
		expect(row.A_moves).toBe(3);
		expect(row.B_moves).toBe(2);
		expect(row.delta_BminusA_moves).toBe(-1);
		expect(row.A_time_to_clear_ms).toBe(600);
		expect(row.B_time_to_clear_ms).toBe(400);
		expect(row.delta_BminusA_time_to_clear_ms).toBe(-200);
		expect(row.q_objects_acc).toBe(0.75);
		expect(row.q_objects_hit_rate).toBe(1);
		expect(row.q_objects_fa_rate).toBe(0.5);
		expect(row.q_objects_dprime).toBeCloseTo(normInv(2.5 / 3) - normInv(1.5 / 3), 8);
		expect(row.q_color_acc).toBe(0.5);
		expect(row.q_color_acc_B).toBe(0.5);
		expect(row.q_color_acc_A).toBeNull();
		expect(row.q_color_conf).toBe(3);
		expect(row.color_blind_answers).toBe(1);
		// memory = 2 color + 1 side-by-side (dont_remember counts as incorrect)
		expect(row.memory_n).toBe(3);
		expect(row.memory_acc).toBeCloseTo(1 / 3, 8);
		expect(row.memory_acc_known).toBe(0.5);
		expect(row.memory_dont_remember_rate).toBeCloseTo(1 / 3, 8);
		expect(row.memory_conf).toBe(3);
		expect(row.sa_env_acc).toBe(1);
		expect(row.q_oral_acc).toBe(1);
		expect(row.A_mismatches).toBe(1);
		expect(row.rpe_1).toBe(17);
		expect(row.pct_hrmax_1).toBe(0.9);
		expect(row.rpe_2).toBeNull();
		expect(row.fitness).toBe(3);
	});
});

describe('buildSummary time limit', () => {
	it('flags a timed-out board and reports pairs found', () => {
		// Board A: one pair found, then time ran out. Board B: cleared.
		const A = seqOf([[0, 3], [1, 0]], cards2);
		const B = seqOf([[0, 3], [1, 2]], cards2, 5000);
		const [row] = buildSummary({
			sessions: [{ pid: 'P02', condition: 'rest', board_a_theme: 'm', board_b_theme: 't', phase: 'done', completed_at: 1 }],
			phases: [
				{ pid: 'P02', phase: 'board_a.play', client_started_at: 1000 },
				{ pid: 'P02', phase: 'board_a.timeout', client_started_at: 91000 },
				{ pid: 'P02', phase: 'board_b.play', client_started_at: 5000 }
			],
			clicks: [...A.map((c) => ({ ...c, pid: 'P02', board: 'A' })), ...B.map((c) => ({ ...c, pid: 'P02', board: 'B' }))],
			sa: [],
			survey: [],
			bouts: [],
			layouts: { m: cards2, t: cards2 },
			saTypes: []
		});
		expect(row.A_timed_out).toBe(1);
		expect(row.A_cleared).toBe(0);
		expect(row.A_pairs_found).toBe(1);
		expect(row.A_time_to_clear_ms).toBeNull();
		expect(row.B_timed_out).toBe(0);
		expect(row.B_pairs_found).toBe(2);
	});
});

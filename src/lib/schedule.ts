import { mulberry32, shuffle } from './rng';
import type { ScheduleRow } from './types';

export interface ScheduleInput {
	conditions: string[];
	theme_orders: string[][];
	n: number;
	seed: number;
}

export function participantId(i: number, n: number): string {
	const width = Math.max(2, String(n).length);
	return 'P' + String(i).padStart(width, '0');
}

/**
 * Block-randomize participants to condition x theme-order cells.
 * Each consecutive block of k = (#conditions * #theme orders) IDs contains every
 * cell exactly once in random order, so cell counts never differ by more than 1.
 */
export function generateSchedule({ conditions, theme_orders, n, seed }: ScheduleInput): ScheduleRow[] {
	if (!conditions.length || !theme_orders.length) throw new Error('need at least one condition and theme order');
	const cells: { condition: string; order: string[] }[] = [];
	for (const condition of conditions) for (const order of theme_orders) cells.push({ condition, order });

	const rand = mulberry32(seed);
	const rows: ScheduleRow[] = [];
	while (rows.length < n) {
		for (const cell of shuffle(cells, rand)) {
			if (rows.length >= n) break;
			rows.push({
				pid: participantId(rows.length + 1, n),
				condition: cell.condition,
				board_a_theme: cell.order[0],
				board_b_theme: cell.order[1],
				seed
			});
		}
	}
	return rows;
}

export interface ExtendInput {
	conditions: string[];
	theme_orders: string[][];
	add: number;
	/** Mark the new rows as remote participants. */
	remote?: boolean;
	/** IDs that must not be reused (e.g. sessions that are no longer in the schedule). */
	taken?: Iterable<string>;
	/** Seed for an empty schedule (otherwise the schedule's own seed is used). */
	seed?: number;
}

/**
 * Append `add` participants to an existing schedule without touching anyone already in it.
 * Each new row goes to a condition x theme-order cell with the fewest rows so far (random
 * among ties), so the cell counts stay within 1 of each other, also after rows were removed.
 * On an untouched schedule this fills the incomplete last block first, then whole new blocks,
 * just like generateSchedule. New IDs continue the numbering (P31, P32, ...) at the same width,
 * and new rows carry the schedule's seed. The shuffle is seeded from that seed and the current
 * length, so adding the same number twice from the same starting point gives the same result.
 */
export function extendSchedule(existing: ScheduleRow[], { conditions, theme_orders, add, remote, taken: extraTaken, seed: emptySeed }: ExtendInput): ScheduleRow[] {
	if (!conditions.length || !theme_orders.length) throw new Error('need at least one condition and theme order');
	if (!Number.isInteger(add) || add < 1) throw new Error('add must be a positive integer');
	const cells: { condition: string; order: string[] }[] = [];
	for (const condition of conditions) for (const order of theme_orders) cells.push({ condition, order });
	const key = (c: { condition: string; order: string[] }) =>
		cellKey({ condition: c.condition, board_a_theme: c.order[0], board_b_theme: c.order[1] });

	const seed = existing[0]?.seed ?? emptySeed ?? 0;
	const rand = mulberry32((seed ^ Math.imul(existing.length + 1, 0x9e3779b1)) >>> 0);
	const nums = existing.map((r) => Number(r.pid.replace(/^\D+/, ''))).filter(Number.isInteger);
	let next = (nums.length ? Math.max(...nums) : 0) + 1;
	const width = Math.max(2, ...existing.map((r) => r.pid.replace(/^\D+/, '').length));
	const taken = new Set([...existing.map((r) => r.pid), ...(extraTaken ?? [])]);

	const count = new Map(cells.map((c) => [key(c), 0]));
	for (const r of existing) if (count.has(cellKey(r))) count.set(cellKey(r), count.get(cellKey(r))! + 1);

	const out: ScheduleRow[] = [];
	let pool: typeof cells = [];
	while (out.length < add) {
		if (!pool.length) {
			const min = Math.min(...count.values());
			pool = shuffle(
				cells.filter((c) => count.get(key(c)) === min),
				rand
			);
		}
		const cell = pool.shift()!;
		count.set(key(cell), count.get(key(cell))! + 1);
		let pid: string;
		do pid = 'P' + String(next++).padStart(width, '0');
		while (taken.has(pid));
		out.push({ pid, condition: cell.condition, board_a_theme: cell.order[0], board_b_theme: cell.order[1], seed, ...(remote ? { remote: true } : {}) });
	}
	return [...existing, ...out];
}

export function cellKey(r: Pick<ScheduleRow, 'condition' | 'board_a_theme' | 'board_b_theme'>): string {
	return `${r.condition}|${r.board_a_theme}>${r.board_b_theme}`;
}

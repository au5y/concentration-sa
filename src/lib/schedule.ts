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

export function cellKey(r: Pick<ScheduleRow, 'condition' | 'board_a_theme' | 'board_b_theme'>): string {
	return `${r.condition}|${r.board_a_theme}>${r.board_b_theme}`;
}

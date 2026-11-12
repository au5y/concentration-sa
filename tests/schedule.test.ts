import { describe, expect, it } from 'vitest';
import { cellKey, generateSchedule, participantId } from '../src/lib/schedule';

const base = {
	conditions: ['rest', 'elevated_hr'],
	theme_orders: [
		['mit', 'transport'],
		['transport', 'mit']
	]
};

function counts(rows: ReturnType<typeof generateSchedule>) {
	const m = new Map<string, number>();
	for (const r of rows) m.set(cellKey(r), (m.get(cellKey(r)) ?? 0) + 1);
	return m;
}

describe('generateSchedule', () => {
	it('assigns 30 participants to 4 cells with 7-8 each', () => {
		const rows = generateSchedule({ ...base, n: 30, seed: 42 });
		expect(rows).toHaveLength(30);
		const c = counts(rows);
		expect(c.size).toBe(4);
		for (const v of c.values()) expect([7, 8]).toContain(v);
		expect([...c.values()].reduce((a, b) => a + b, 0)).toBe(30);
	});

	it('is balanced within every complete block of 4', () => {
		for (const seed of [1, 2, 3, 99, 123456]) {
			const rows = generateSchedule({ ...base, n: 30, seed });
			for (let b = 0; b + 4 <= rows.length; b += 4) {
				expect(new Set(rows.slice(b, b + 4).map(cellKey)).size).toBe(4);
			}
		}
	});

	it('never lets cell counts differ by more than 1, for any n', () => {
		for (let n = 1; n <= 41; n++) {
			const c = [...counts(generateSchedule({ ...base, n, seed: n * 7 })).values()];
			expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
		}
	});

	it('is deterministic for a seed and records it', () => {
		const a = generateSchedule({ ...base, n: 30, seed: 7 });
		const b = generateSchedule({ ...base, n: 30, seed: 7 });
		const c = generateSchedule({ ...base, n: 30, seed: 8 });
		expect(a).toEqual(b);
		expect(a.map(cellKey)).not.toEqual(c.map(cellKey));
		expect(a.every((r) => r.seed === 7)).toBe(true);
	});

	it('numbers participants P01..PNN and keeps theme orders intact', () => {
		const rows = generateSchedule({ ...base, n: 30, seed: 1 });
		expect(rows[0].pid).toBe('P01');
		expect(rows[29].pid).toBe('P30');
		for (const r of rows) expect(r.board_a_theme).not.toBe(r.board_b_theme);
		expect(participantId(7, 120)).toBe('P007');
	});

	it('handles arbitrary numbers of conditions and orders', () => {
		const rows = generateSchedule({ conditions: ['a', 'b', 'c'], theme_orders: [['x', 'y']], n: 9, seed: 5 });
		expect([...counts(rows).values()]).toEqual([3, 3, 3]);
	});
});

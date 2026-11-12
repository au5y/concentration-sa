import { describe, expect, it } from 'vitest';
import { generateLayout, hasAdjacentPair } from '../src/lib/layout';
import { mulberry32 } from '../src/lib/rng';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('generateLayout', () => {
	it('places every object exactly twice on a 4x4 board', () => {
		const cards = generateLayout(ids, 4, 4, mulberry32(1));
		expect(cards).toHaveLength(16);
		for (const id of ids) expect(cards.filter((c) => c === id)).toHaveLength(2);
	});

	it('works for the 3x4 practice board', () => {
		const cards = generateLayout(ids.slice(0, 6), 3, 4, mulberry32(2));
		expect(cards).toHaveLength(12);
		expect(hasAdjacentPair(cards, 4)).toBe(false);
	});

	it('never puts a pair side by side or stacked', () => {
		for (let seed = 0; seed < 200; seed++) {
			expect(hasAdjacentPair(generateLayout(ids, 4, 4, mulberry32(seed)), 4)).toBe(false);
		}
	});

	it('is deterministic per seed', () => {
		expect(generateLayout(ids, 4, 4, mulberry32(9))).toEqual(generateLayout(ids, 4, 4, mulberry32(9)));
		expect(generateLayout(ids, 4, 4, mulberry32(9))).not.toEqual(generateLayout(ids, 4, 4, mulberry32(10)));
	});

	it('rejects mismatched board sizes and duplicate ids', () => {
		expect(() => generateLayout(ids, 3, 4, mulberry32(1))).toThrow();
		expect(() => generateLayout(['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], 4, 4, mulberry32(1))).toThrow();
	});
});

describe('hasAdjacentPair', () => {
	it('detects horizontal and vertical neighbours but not row wrap-around', () => {
		expect(hasAdjacentPair(['a', 'a', 'b', 'b'], 2)).toBe(true);
		expect(hasAdjacentPair(['a', 'b', 'a', 'b'], 2)).toBe(true); // vertical
		expect(hasAdjacentPair(['a', 'b', 'b', 'a'], 2)).toBe(false); // diagonal only
		// 'b' at end of row 0 and start of row 1 is not adjacent
		expect(hasAdjacentPair(['a', 'c', 'b', 'b', 'd', 'a'], 3)).toBe(false);
	});
});

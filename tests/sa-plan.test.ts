import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/rng';
import { buildSaPlan } from '../src/lib/sa-plan';
import type { ThemeManifest } from '../src/lib/types';

const mk = (theme: string): ThemeManifest => ({
	theme,
	objects: Array.from({ length: 8 }, (_, i) => ({ id: `${theme}${i}`, label: '', image: '', color: 'red', orientation: 'up', variant: { mirror: true } })),
	foils: Array.from({ length: 8 }, (_, i) => ({ id: `${theme}f${i}`, label: '', image: '', color: 'red', orientation: 'up' }))
});

describe('buildSaPlan', () => {
	const manifests = { m: mk('m'), t: mk('t') };
	const boards = [
		{ board: 'A', theme: 'm' },
		{ board: 'B', theme: 't' }
	];
	const types = ['objects', 'color', 'orientation', 'side_by_side'] as const;

	it('runs each theme as a block with questions in config order', () => {
		const plan = buildSaPlan(boards, manifests, [...types], mulberry32(3));
		expect(plan).toHaveLength(2 * (1 + 8 * 3));
		const firstTheme = plan[0].theme;
		expect(plan.slice(0, 25).every((s) => s.theme === firstTheme)).toBe(true);
		expect(plan.slice(25).every((s) => s.theme !== firstTheme)).toBe(true);
		expect(plan[0].type).toBe('objects');
		expect(plan.slice(1, 9).every((s) => s.type === 'color')).toBe(true);
		expect(plan.map((s) => s.seq)).toEqual(plan.map((_, i) => i));
	});

	it('shows all 8 seen objects plus 8 foils in the recognition grid', () => {
		const plan = buildSaPlan(boards, manifests, [...types], mulberry32(3));
		const grid = plan.find((s) => s.type === 'objects')!;
		expect(grid.type === 'objects' && new Set(grid.items).size).toBe(16);
	});

	it('randomizes block order across participants', () => {
		const firsts = new Set(Array.from({ length: 20 }, (_, i) => buildSaPlan(boards, manifests, [...types], mulberry32(i))[0].board));
		expect(firsts).toEqual(new Set(['A', 'B']));
	});
});

describe('buildSaPlan with sa_random_per_theme', () => {
	const manifests = { m: mk('m'), t: mk('t') };
	const boards = [
		{ board: 'A', theme: 'm' },
		{ board: 'B', theme: 't' }
	];

	it('asks the grid plus 4 questions per theme: 10 in total', () => {
		for (let seed = 0; seed < 50; seed++) {
			const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'side_by_side'], mulberry32(seed), 4);
			expect(plan).toHaveLength(10);
			for (const block of [plan.slice(0, 5), plan.slice(5)]) {
				expect(block[0].type).toBe('objects');
				expect(new Set(block.map((s) => s.theme)).size).toBe(1);
				const rest = block.slice(1);
				// types balanced 2/2, every question about a different seen object
				expect(rest.filter((s) => s.type === 'color')).toHaveLength(2);
				expect(rest.filter((s) => s.type === 'side_by_side')).toHaveLength(2);
				const items = rest.map((s) => ('item' in s ? s.item : ''));
				expect(new Set(items).size).toBe(4);
				expect(items.every((i) => manifests[block[0].theme as 'm' | 't'].objects.some((o) => o.id === i))).toBe(true);
			}
			expect(plan.map((s) => s.seq)).toEqual(plan.map((_, i) => i));
		}
	});

	it('spreads an uneven count over three types', () => {
		const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'orientation', 'side_by_side'], mulberry32(1), 4);
		const block = plan.slice(1, 5);
		const counts = ['color', 'orientation', 'side_by_side'].map((t) => block.filter((s) => s.type === t).length);
		expect(counts.sort()).toEqual([1, 1, 2]);
	});
});

describe('buildSaPlan shorter settings', () => {
	const boards = [
		{ board: 'A', theme: 'm' },
		{ board: 'B', theme: 't' }
	];

	it('limits the grid to a random subset of foils', () => {
		const manifests = { m: mk('m'), t: mk('t') };
		const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'side_by_side'], mulberry32(5), 2, 4);
		expect(plan).toHaveLength(6);
		for (const g of plan.filter((s) => s.type === 'objects')) {
			expect(g.type === 'objects' && g.items.length).toBe(12);
		}
	});

	it('never asks a color question about an original (as-is) image', () => {
		const m = mk('m');
		// only two recolorable objects
		m.objects.forEach((o, i) => (o.render = i < 2 ? 'mask' : 'original'));
		const manifests = { m, t: mk('t') };
		for (let seed = 0; seed < 100; seed++) {
			const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'side_by_side'], mulberry32(seed), 4);
			const colorItems = plan.filter((s) => s.theme === 'm' && s.type === 'color').map((s) => ('item' in s ? s.item : ''));
			expect(colorItems.every((id) => id === 'm0' || id === 'm1')).toBe(true);
			expect(plan.filter((s) => s.theme === 'm' && s.type !== 'objects')).toHaveLength(4);
		}
		const all = buildSaPlan(boards, manifests, ['color'], mulberry32(1));
		expect(all.filter((s) => s.theme === 'm')).toHaveLength(2);
	});

	it('only asks side-by-side about objects that have a variant', () => {
		const m = mk('m');
		m.objects.forEach((o, i) => {
			if (i >= 2) delete o.variant;
		});
		const manifests = { m, t: mk('t') };
		for (let seed = 0; seed < 100; seed++) {
			const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'side_by_side'], mulberry32(seed), 4);
			const sbs = plan.filter((s) => s.theme === 'm' && s.type === 'side_by_side').map((s) => ('item' in s ? s.item : ''));
			expect(sbs.every((id) => id === 'm0' || id === 'm1')).toBe(true);
		}
	});
});

describe('buildSaPlan with fixed side-by-side items', () => {
	const manifests = { m: mk('m'), t: mk('t') };
	const boards = [
		{ board: 'A', theme: 'm' },
		{ board: 'B', theme: 't' }
	];
	it('asks exactly the listed objects side by side, mixed in random order with the random questions', () => {
		const orders = new Set<string>();
		for (let seed = 0; seed < 30; seed++) {
			const plan = buildSaPlan(boards, manifests, ['objects', 'color', 'side_by_side'], mulberry32(seed), 2, undefined, [], undefined, {
				m: ['m0', 'm1']
			});
			const m = plan.filter((s) => s.theme === 'm' && s.type !== 'objects');
			expect(m.filter((s) => s.type === 'side_by_side').map((s) => (s as { item: string }).item).sort()).toEqual(['m0', 'm1']);
			const color = m.filter((s) => s.type === 'color');
			expect(color).toHaveLength(2);
			for (const s of color) expect(['m0', 'm1']).not.toContain((s as { item: string }).item);
			orders.add(m.map((s) => s.type).join());
			// a theme without a fixed list keeps the random mix
			expect(plan.filter((s) => s.theme !== 'm' && s.type !== 'objects')).toHaveLength(2);
		}
		expect(orders.size).toBeGreaterThan(1);
	});
});

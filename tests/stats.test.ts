import { describe as group, expect, it } from 'vitest';
import { describe, fmtP, paired, tCrit, tTwoSidedP, welch } from '../src/lib/stats';

group('t distribution', () => {
	it('matches closed forms for df = 1 and df = 2', () => {
		for (const t of [0.3, 1, 2.5, 7]) {
			expect(tTwoSidedP(t, 1)).toBeCloseTo(1 - (2 / Math.PI) * Math.atan(t), 8);
			expect(tTwoSidedP(t, 2)).toBeCloseTo(1 - t / Math.sqrt(t * t + 2), 8);
		}
	});
	it('matches published values', () => {
		expect(tTwoSidedP(2, 10)).toBeCloseTo(0.073388, 5);
		expect(tCrit(10)).toBeCloseTo(2.228139, 4);
		expect(tCrit(1)).toBeCloseTo(12.7062, 3);
		expect(tCrit(1e6)).toBeCloseTo(1.95996, 3);
	});
});

group('tests', () => {
	it('describe gives mean, sd and a t-based CI, ignoring blanks', () => {
		const d = describe([1, 2, 3, 4, 5, null, NaN, 'x']);
		expect(d.n).toBe(5);
		expect(d.mean).toBe(3);
		expect(d.sd).toBeCloseTo(Math.sqrt(2.5), 10);
		expect(d.hi! - d.mean!).toBeCloseTo((tCrit(4) * Math.sqrt(2.5)) / Math.sqrt(5), 10);
	});
	it('welch: Welch–Satterthwaite df and Cohen d', () => {
		const w = welch([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])!;
		expect(w.diff).toBe(3);
		expect(w.t).toBeCloseTo(3 / Math.sqrt(0.5 + 2), 10);
		expect(w.df).toBeCloseTo(6.25 / (0.25 / 4 + 4 / 4), 10);
		expect(w.d).toBeCloseTo(3 / Math.sqrt((2.5 + 10) / 2), 10);
		expect(w.p).toBeGreaterThan(0.1);
		expect(w.p).toBeLessThan(0.12);
		expect(welch([1], [2, 3])).toBeNull();
	});
	it('paired: drops incomplete pairs', () => {
		const p = paired([
			[1, 3],
			[2, 5],
			[3, 4],
			[4, 8],
			[5, 7],
			[6, null]
		])!;
		expect(p.n).toBe(5);
		expect(p.diff).toBeCloseTo(2.4, 10);
		expect(p.t).toBeCloseTo(2.4 / (Math.sqrt(1.3) / Math.sqrt(5)), 10);
		expect(p.df).toBe(4);
		expect(p.d).toBeCloseTo(2.4 / Math.sqrt(1.3), 10);
	});
	it('formats p APA style', () => {
		expect(fmtP(0.0321)).toBe('p = .032');
		expect(fmtP(0.0004)).toBe('p < .001');
	});
});

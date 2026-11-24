/**
 * Small-sample statistics for the data explorer: descriptives with t-based 95% CIs,
 * Welch's two-sample t-test (between conditions) and the paired t-test (within participants).
 * Everything ignores null / non-finite values.
 */

export const finite = (xs: unknown[]): number[] => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** log Γ(x), Lanczos approximation (x > 0). */
function lgamma(x: number): number {
	const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
	let y = x;
	const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
	let ser = 1.000000000190015;
	for (const k of c) ser += k / ++y;
	return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
	const FPMIN = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < FPMIN) d = FPMIN;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= 300; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c;
		if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c;
		if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < 1e-12) break;
	}
	return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
	return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a t statistic with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
	if (!Number.isFinite(t)) return 0;
	return incBeta(df / (df + t * t), df / 2, 0.5);
}

/** Critical t for a two-sided interval at `level` (e.g. 0.95). */
export function tCrit(df: number, level = 0.95): number {
	const target = 1 - level; // two-sided p
	let lo = 0;
	let hi = 1000;
	for (let i = 0; i < 100; i++) {
		const mid = (lo + hi) / 2;
		if (tTwoSidedP(mid, df) > target) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

export interface Describe {
	n: number;
	mean: number | null;
	sd: number | null;
	/** 95% CI of the mean (t-based); null with fewer than 2 values. */
	lo: number | null;
	hi: number | null;
}

export function describe(values: unknown[]): Describe {
	const xs = finite(values);
	const n = xs.length;
	if (!n) return { n, mean: null, sd: null, lo: null, hi: null };
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	if (n < 2) return { n, mean, sd: null, lo: null, hi: null };
	const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
	const half = (tCrit(n - 1) * sd) / Math.sqrt(n);
	return { n, mean, sd, lo: mean - half, hi: mean + half };
}

export interface TTest {
	/** b − a (Welch) or mean of y − x (paired). */
	diff: number;
	lo: number;
	hi: number;
	t: number;
	df: number;
	p: number;
	/** Effect size: Cohen's d (pooled SD) for Welch, d_z (mean diff / SD of diffs) for paired. */
	d: number | null;
}

/** Welch's t-test of b vs a (diff = mean(b) − mean(a)). Needs ≥ 2 values per group. */
export function welch(aVals: unknown[], bVals: unknown[]): TTest | null {
	const a = describe(aVals);
	const b = describe(bVals);
	if (a.n < 2 || b.n < 2 || a.sd === null || b.sd === null) return null;
	const va = (a.sd ** 2) / a.n;
	const vb = (b.sd ** 2) / b.n;
	const se = Math.sqrt(va + vb);
	const diff = b.mean! - a.mean!;
	if (se === 0) return null;
	const t = diff / se;
	const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
	const half = tCrit(df) * se;
	const pooled = Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2));
	return { diff, lo: diff - half, hi: diff + half, t, df, p: tTwoSidedP(t, df), d: pooled > 0 ? diff / pooled : null };
}

/** Paired t-test on y − x over pairs where both values exist. */
export function paired(pairs: [unknown, unknown][]): (TTest & { n: number }) | null {
	const diffs = pairs
		.filter(([x, y]) => finite([x]).length && finite([y]).length)
		.map(([x, y]) => (y as number) - (x as number));
	const d = describe(diffs);
	if (d.n < 2 || d.sd === null) return null;
	if (d.sd === 0) return null;
	const se = d.sd / Math.sqrt(d.n);
	const t = d.mean! / se;
	return { n: d.n, diff: d.mean!, lo: d.lo!, hi: d.hi!, t, df: d.n - 1, p: tTwoSidedP(t, d.n - 1), d: d.mean! / d.sd };
}

/** "p = .032", "p < .001" (APA style). */
export function fmtP(p: number): string {
	if (p < 0.001) return 'p < .001';
	return `p = ${p.toFixed(3).replace(/^0/, '')}`;
}

/** Small helpers for the explorer's SVG charts. */

/** About `count` round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
	if (!(hi > lo)) return [lo];
	const raw = (hi - lo) / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
	return out;
}

/** Domain with a little padding, snapped to ticks; `fixed` wins (e.g. [0, 1] for accuracy). */
export function domainOf(values: number[], fixed?: [number, number]): [number, number] {
	if (fixed) return fixed;
	if (!values.length) return [0, 1];
	let lo = Math.min(...values);
	let hi = Math.max(...values);
	if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
	const pad = (hi - lo) * 0.08;
	const t = niceTicks(lo - pad, hi + pad);
	const step = t.length > 1 ? t[1] - t[0] : 1;
	return [Math.min(t[0], Math.floor((lo - pad) / step) * step), Math.max(t.at(-1)!, Math.ceil((hi + pad) / step) * step)];
}

/** Deterministic horizontal jitter in [-1, 1] from a participant id, so dots don't move between reloads. */
export function jitter(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
	return ((h >>> 0) / 4294967295) * 2 - 1;
}

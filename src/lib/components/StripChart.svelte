<script lang="ts">
	import { domainOf, jitter, niceTicks } from '$lib/chart';
	import type { Describe } from '$lib/stats';

	/**
	 * One dot per participant for each group, with the group mean and its 95% CI.
	 * Hover a dot for the participant and value; click it to open the participant.
	 */
	interface Group {
		label: string;
		color: string;
		points: { pid: string; v: number }[];
		stats: Describe;
	}
	let {
		groups,
		fmt,
		domain,
		href
	}: { groups: Group[]; fmt: (v: number) => string; domain?: [number, number]; href: (pid: string) => string } = $props();

	const W = 300;
	const H = 190;
	const M = { l: 40, r: 8, t: 10, b: 34 };
	// The CI is clipped to the axis, so only the dots set the range.
	const [lo, hi] = $derived(domainOf(groups.flatMap((g) => g.points.map((p) => p.v)), domain));
	const ticks = $derived(niceTicks(lo, hi, 4));
	const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
	const band = $derived((W - M.l - M.r) / Math.max(1, groups.length));
	const cx = (i: number) => M.l + band * (i + 0.5);
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-label="Dot plot by group with means and 95% confidence intervals">
	{#each ticks as t (t)}
		<line class="grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
		<text class="tick" x={M.l - 5} y={y(t)} text-anchor="end" dominant-baseline="middle">{fmt(t)}</text>
	{/each}
	{#each groups as g, i (g.label)}
		{#each g.points as p (p.pid)}
			<a href={href(p.pid)}>
				<circle class="dot" cx={cx(i) - 26 + jitter(p.pid) * 14} cy={y(p.v)} r="4" fill={g.color}>
					<title>{p.pid} · {g.label}: {fmt(p.v)}</title>
				</circle>
			</a>
		{/each}
		{#if g.stats.mean !== null}
			{@const mx = cx(i) + 18}
			{#if g.stats.lo !== null && g.stats.hi !== null}
				<line class="ci" x1={mx} x2={mx} y1={y(Math.max(lo, g.stats.lo))} y2={y(Math.min(hi, g.stats.hi))} />
				<line class="cap" x1={mx - 4} x2={mx + 4} y1={y(Math.max(lo, g.stats.lo))} y2={y(Math.max(lo, g.stats.lo))} />
				<line class="cap" x1={mx - 4} x2={mx + 4} y1={y(Math.min(hi, g.stats.hi))} y2={y(Math.min(hi, g.stats.hi))} />
			{/if}
			<rect class="mean" x={mx - 7} y={y(g.stats.mean) - 3} width="14" height="6" rx="2" fill={g.color}>
				<title>{g.label} mean {fmt(g.stats.mean)}{g.stats.lo !== null ? ` (95% CI ${fmt(g.stats.lo)} to ${fmt(g.stats.hi!)})` : ''} · n = {g.stats.n}</title>
			</rect>
		{/if}
		<text class="label" x={cx(i)} y={H - M.b + 15} text-anchor="middle">{g.label}</text>
		<text class="n" x={cx(i)} y={H - M.b + 28} text-anchor="middle">n = {g.stats.n}</text>
	{/each}
</svg>

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: #e6e6e6;
		stroke-width: 1;
	}
	.tick,
	.n {
		font-size: 9px;
		fill: #6b6b6b;
		font-variant-numeric: tabular-nums;
	}
	.label {
		font-size: 11px;
		fill: #222;
		font-weight: 600;
	}
	.dot {
		stroke: #fff;
		stroke-width: 2;
		paint-order: stroke;
		opacity: 0.85;
		cursor: pointer;
	}
	.dot:hover {
		opacity: 1;
		stroke: #111;
		stroke-width: 1.5;
	}
	.ci,
	.cap {
		stroke: #222;
		stroke-width: 1.5;
	}
	.mean {
		stroke: #222;
		stroke-width: 1.5;
	}
</style>

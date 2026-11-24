<script lang="ts">
	import { domainOf, niceTicks } from '$lib/chart';

	/**
	 * Within-participant comparison: one line per participant from the left value to the right
	 * value (colored by their condition), and a thick dark line joining the two means.
	 */
	interface Pair {
		pid: string;
		a: number;
		b: number;
		color: string;
		group: string;
	}
	let {
		pairs,
		labels,
		fmt,
		domain,
		href
	}: { pairs: Pair[]; labels: [string, string]; fmt: (v: number) => string; domain?: [number, number]; href: (pid: string) => string } = $props();

	const W = 300;
	const H = 190;
	const M = { l: 40, r: 14, t: 10, b: 22 };
	const [lo, hi] = $derived(domainOf(pairs.flatMap((p) => [p.a, p.b]), domain));
	const ticks = $derived(niceTicks(lo, hi, 4));
	const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
	const xa = M.l + 40;
	const xb = W - M.r - 40;
	const meanA = $derived(pairs.length ? pairs.reduce((s, p) => s + p.a, 0) / pairs.length : null);
	const meanB = $derived(pairs.length ? pairs.reduce((s, p) => s + p.b, 0) / pairs.length : null);
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-label="Paired values per participant: {labels[0]} vs {labels[1]}">
	{#each ticks as t (t)}
		<line class="grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
		<text class="tick" x={M.l - 5} y={y(t)} text-anchor="end" dominant-baseline="middle">{fmt(t)}</text>
	{/each}
	{#each pairs as p (p.pid)}
		<a href={href(p.pid)}>
			<g class="pair">
				<title>{p.pid} ({p.group}) · {labels[0]} {fmt(p.a)} → {labels[1]} {fmt(p.b)}</title>
				<line class="hit" x1={xa} x2={xb} y1={y(p.a)} y2={y(p.b)} />
				<line class="seg" x1={xa} x2={xb} y1={y(p.a)} y2={y(p.b)} stroke={p.color} />
				<circle cx={xa} cy={y(p.a)} r="4" fill={p.color} />
				<circle cx={xb} cy={y(p.b)} r="4" fill={p.color} />
			</g>
		</a>
	{/each}
	{#if meanA !== null && meanB !== null}
		<g class="meanline">
			<title>Mean: {labels[0]} {fmt(meanA)} → {labels[1]} {fmt(meanB)} (n = {pairs.length})</title>
			<line x1={xa} x2={xb} y1={y(meanA)} y2={y(meanB)} />
			<rect x={xa - 7} y={y(meanA) - 3} width="14" height="6" rx="2" />
			<rect x={xb - 7} y={y(meanB) - 3} width="14" height="6" rx="2" />
		</g>
	{/if}
	<text class="label" x={xa} y={H - 6} text-anchor="middle">{labels[0]}</text>
	<text class="label" x={xb} y={H - 6} text-anchor="middle">{labels[1]}</text>
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
	}
	.tick {
		font-size: 9px;
		fill: #6b6b6b;
		font-variant-numeric: tabular-nums;
	}
	.label {
		font-size: 11px;
		fill: #222;
		font-weight: 600;
	}
	.pair {
		cursor: pointer;
		opacity: 0.55;
	}
	.pair:hover {
		opacity: 1;
	}
	.seg {
		stroke-width: 2;
	}
	.hit {
		stroke: transparent;
		stroke-width: 10;
	}
	.pair circle {
		stroke: #fff;
		stroke-width: 2;
		paint-order: stroke;
	}
	.meanline {
		pointer-events: all;
	}
	.meanline line {
		stroke: #222;
		stroke-width: 3;
	}
	.meanline rect {
		fill: #222;
	}
</style>

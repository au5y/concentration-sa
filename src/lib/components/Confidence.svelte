<script lang="ts">
	let {
		scale,
		labels,
		value,
		onPick
	}: { scale: number; labels: [string, string]; value: number | null; onPick: (n: number) => void } = $props();
</script>

<div class="conf">
	<p>How sure?</p>
	<div class="row">
		<span class="lab">{labels[0]}</span>
		{#each Array.from({ length: scale }, (_, i) => i + 1) as n (n)}
			<button class:sel={value === n} onclick={() => onPick(n)}>{n}</button>
		{/each}
		<span class="lab">{labels[1]}</span>
	</div>
</div>

<style>
	.conf {
		text-align: center;
		margin-top: 1.5rem;
	}
	p {
		font-size: 1.4rem;
		margin: 0 0 0.6rem;
	}
	.row {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		justify-content: center;
	}
	.lab {
		color: #555;
		width: 8rem;
	}
	.lab:first-child {
		text-align: right;
	}
	button {
		font-size: 1.6rem;
		width: 4rem;
		height: 4rem;
		border-radius: 50%;
		border: 2px solid #1f63d6;
		background: white;
		cursor: pointer;
	}
	button:hover {
		background: #eef4ff;
	}
	button.sel {
		background: #1f63d6;
		color: white;
	}
</style>

<script lang="ts">
	import type { PhaseText } from '$lib/types';

	/**
	 * Exercise / rest screen. The participant sees the instructions; at the end of the bout
	 * the facilitator asks for RPE (show the Borg card), taps it, optionally types the peak HR
	 * from the monitor, then presses the shortcut to continue.
	 */
	let {
		text,
		saved,
		onSave
	}: {
		text: PhaseText;
		saved: { rpe: number; peak_hr: number | null } | null;
		onSave: (rpe: number, peakHr: number | null) => Promise<void>;
	} = $props();

	const BORG: Record<number, string> = {
		6: 'No exertion',
		7: 'Extremely light',
		9: 'Very light',
		11: 'Light',
		13: 'Somewhat hard',
		15: 'Hard',
		17: 'Very hard',
		19: 'Extremely hard',
		20: 'Maximal'
	};

	// svelte-ignore state_referenced_locally
	let rpe = $state<number | null>(saved?.rpe ?? null);
	// svelte-ignore state_referenced_locally
	let peak = $state<number | null>(saved?.peak_hr ?? null);
	// svelte-ignore state_referenced_locally
	let status = $state(saved ? 'saved' : '');
	let open = $state(false);

	async function save() {
		if (rpe === null) return;
		status = 'saving…';
		try {
			await onSave(rpe, peak);
			status = 'saved';
		} catch (e) {
			status = `not saved: ${(e as Error).message}`;
		}
	}
</script>

<div class="full">
	<h1>{text.title}</h1>
	<p class="body">{text.body}</p>
	<p class="wait">Wait for facilitator</p>
</div>

<div class="facil" class:done={status === 'saved'}>
	{#if !open}
		<button class="toggle" onclick={() => (open = true)}>
			Facilitator: {status === 'saved' ? `RPE ${rpe}${peak ? ` · peak HR ${peak}` : ''} saved ✓` : 'record RPE at end of bout ▸'}
		</button>
	{:else}
		<p class="head">
			<b>End of bout:</b> show the Borg card and ask "How hard did that feel?", then tap the number.
			<button class="close" onclick={() => (open = false)}>hide</button>
		</p>
		<div class="borg">
			{#each Array.from({ length: 15 }, (_, i) => i + 6) as n (n)}
				<button class:sel={rpe === n} onclick={() => ((rpe = n), save())}>
					<b>{n}</b><span>{BORG[n] ?? ''}</span>
				</button>
			{/each}
		</div>
		<p class="row">
			<label>Peak HR from monitor (optional)
				<input
					type="number"
					min="30"
					max="250"
					inputmode="numeric"
					placeholder="bpm"
					value={peak ?? ''}
					oninput={(e) => {
						const v = e.currentTarget.valueAsNumber;
						peak = Number.isFinite(v) ? Math.round(v) : null;
					}}
					onchange={save}
				/>
			</label>
			<span class="status">{status}</span>
			<span class="hint">Then press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to continue.</span>
		</p>
	{/if}
</div>

<style>
	.full {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2rem;
		box-sizing: border-box;
	}
	h1 {
		font-size: 3.5rem;
		margin: 0 0 1rem;
	}
	.body {
		font-size: 1.8rem;
		max-width: 40ch;
	}
	.wait {
		margin-top: 3rem;
		font-size: 2.4rem;
		font-weight: 700;
		color: #1f63d6;
	}
	.facil {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		background: #fff8dc;
		border-top: 2px solid #e0a800;
		padding: 0.5rem 1rem;
	}
	.facil.done {
		background: #eef8f0;
		border-color: #2a9d3f;
	}
	.toggle,
	.close {
		background: none;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		color: #333;
	}
	.close {
		float: right;
		color: #777;
	}
	.head {
		margin: 0.2rem 0 0.5rem;
	}
	.borg {
		display: grid;
		grid-template-columns: repeat(15, 1fr);
		gap: 0.25rem;
	}
	.borg button {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.25rem 0.1rem;
		font-size: 1.1rem;
		background: white;
		border: 2px solid #ccc;
		border-radius: 6px;
		cursor: pointer;
	}
	.borg span {
		font-size: 0.6rem;
		color: #555;
		min-height: 1.4em;
	}
	.borg button.sel {
		border-color: #1f63d6;
		background: #eef4ff;
	}
	.row {
		display: flex;
		gap: 1.2rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.5rem 0 0.2rem;
	}
	input {
		width: 5rem;
		font-size: 1rem;
		margin-left: 0.4rem;
	}
	.status {
		color: #2a6;
	}
	.hint {
		color: #666;
	}
	kbd {
		border: 1px solid #aaa;
		border-radius: 4px;
		padding: 0 0.3em;
		background: #f4f4f4;
	}
</style>

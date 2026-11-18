<script lang="ts">
	import { onMount } from 'svelte';
	import { Metronome, audioReady, primeAudio, unlockAudio } from '$lib/client/metronome';
	import type { PhaseText } from '$lib/types';

	/**
	 * Exercise / rest screen. The participant sees the instructions and a countdown. When it
	 * reaches 0:00 the screen says "Time's up" and, for conditions that record RPE, the
	 * facilitator panel opens: show the Borg card ("Show Borg scale" fills the screen with it),
	 * tap the rating, optionally type the peak HR, then press the shortcut to continue.
	 * The countdown waits for Start (the button, or the facilitator shortcut), so it can begin when
	 * the participant actually starts. The facilitator can continue before it ends (the shortcut asks
	 * for a second press).
	 */
	let {
		text,
		saved,
		onSave,
		recordRpe,
		metronomeBpm = null,
		durationMs,
		startedAt,
		onStart,
		clockOffset,
		remote = false
	}: {
		text: PhaseText;
		saved: { rpe: number; peak_hr: number | null } | null;
		onSave: (rpe: number, peakHr: number | null) => Promise<void>;
		/** false (e.g. the rest condition): no RPE panel. */
		recordRpe: boolean;
		/** Step-test metronome tempo; clicks while the countdown runs. null = none. */
		metronomeBpm?: number | null;
		/** Countdown length; 0 = no countdown. */
		durationMs: number;
		/** Server time Start was pressed, or null if not yet. */
		startedAt: number | null;
		onStart: () => Promise<void>;
		/** Server clock minus this computer's clock. */
		clockOffset: number;
		/** Remote participant's own screen: no facilitator panel (RPE is entered on the console). */
		remote?: boolean;
	} = $props();

	/** Borg 6-20 verbal anchors (Borg, 1998). */
	const BORG: Record<number, string> = {
		6: 'No exertion at all',
		7: 'Extremely light',
		9: 'Very light',
		11: 'Light',
		13: 'Somewhat hard',
		15: 'Hard (heavy)',
		17: 'Very hard',
		19: 'Extremely hard',
		20: 'Maximal exertion'
	};
	/** What the anchor feels like, read to the participant with the card. */
	const BORG_HINT: Record<number, string> = {
		6: 'Sitting or standing still',
		9: 'Like walking slowly at your own pace',
		13: 'Starting to feel it, but fine to keep going',
		15: 'Breathing hard, tiring',
		17: 'You have to push yourself to keep going',
		19: 'The hardest exercise you have ever done',
		20: 'Absolute maximum'
	};
	const LEVELS = Array.from({ length: 15 }, (_, i) => i + 6);
	/** Green (6) to red (20). */
	const hue = (n: number) => Math.round(130 - ((n - 6) / 14) * 130);

	// svelte-ignore state_referenced_locally
	let rpe = $state<number | null>(saved?.rpe ?? null);
	// svelte-ignore state_referenced_locally
	let peak = $state<number | null>(saved?.peak_hr ?? null);
	// svelte-ignore state_referenced_locally
	let status = $state(saved ? 'saved' : '');
	let open = $state(false);
	let showCard = $state(false);

	let now = $state(Date.now());
	let starting = $state(false);
	const remaining = $derived(
		durationMs > 0 ? (startedAt === null ? durationMs : Math.max(0, startedAt + durationMs - (now + clockOffset))) : 0
	);
	const timeUp = $derived(durationMs > 0 && remaining === 0);
	const clock = $derived.by(() => {
		const s = Math.ceil(remaining / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	onMount(() => {
		primeAudio();
		const t = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(t);
	});

	// Metronome: on from Start until time's up (or the whole screen if there is no countdown).
	// Harvard step test: up, up, down, down, one step per click.
	const STEPS = ['Up', 'Up', 'Down', 'Down'];
	let muted = $state(false);
	let pulse = $state(false);
	let beat = $state(-1);
	let met: Metronome | null = null;
	const ticking = $derived(!!metronomeBpm && (durationMs > 0 ? startedAt !== null && !timeUp : true));
	// Re-checked with the 250 ms clock: has the browser let the page make sound yet?
	const soundBlocked = $derived(ticking && !muted && now > 0 && !audioReady());
	$effect(() => {
		if (!ticking || !metronomeBpm) return;
		const m = new Metronome(metronomeBpm, (b) => {
			beat = b;
			pulse = true;
			setTimeout(() => (pulse = false), 120);
		});
		m.muted = muted;
		met = m;
		m.start();
		return () => {
			m.stop();
			met = null;
			beat = -1;
		};
	});
	$effect(() => {
		if (met) met.muted = muted;
	});

	// Time's up: bring up the RPE panel for the facilitator.
	$effect(() => {
		if (timeUp && recordRpe && !remote && status !== 'saved') open = true;
	});

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

	function pickFromCard(n: number) {
		rpe = n;
		save();
		showCard = false;
	}
</script>

<div class="full">
	<h1>{text.title}</h1>
	<p class="body">{text.body}</p>
	{#if durationMs > 0 && startedAt === null}
		<p class="clock idle" aria-live="off">{clock}</p>
		<button class="start" disabled={starting} onclick={() => ((starting = true), onStart().finally(() => (starting = false)))}>Start</button>
	{:else if durationMs > 0 && !timeUp}
		<p class="clock" aria-live="off">{clock}</p>
	{/if}
	{#if metronomeBpm && !timeUp}
		<div class="metro">
			<div class="beat" class:on={pulse && ticking} class:idle={!ticking}>
				<span class="step">{ticking && beat >= 0 ? STEPS[beat % 4] : 'Step'}</span>
				<span class="tempo">{metronomeBpm} BPM</span>
			</div>
			<p class="metro-hint">Step with each click: up, up, down, down.</p>
			{#if soundBlocked}
				<button class="unlock" onclick={() => unlockAudio()}>🔈 Tap here to turn on the sound</button>
			{:else}
				<button class="mute" onclick={() => (muted = !muted)}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
			{/if}
		</div>
	{/if}
	{#if timeUp}
		<p class="up">Time's up</p>
		<p class="wait">Wait for facilitator</p>
	{:else if durationMs === 0}
		<p class="wait">Wait for facilitator</p>
	{/if}
</div>

{#if showCard}
	<div class="card" role="dialog" aria-label="Borg rating of perceived exertion">
		<header>
			<h2>How hard did that feel?</h2>
			<p>Point to the number that best describes your effort.</p>
			<button class="cardclose" onclick={() => (showCard = false)}>✕ close</button>
		</header>
		<ol class="scale">
			{#each LEVELS as n (n)}
				<li>
					<button class:sel={rpe === n} style:--h={hue(n)} onclick={() => pickFromCard(n)}>
						<b>{n}</b>
						<span class="anchor">{BORG[n] ?? ''}</span>
						<span class="hint">{BORG_HINT[n] ?? ''}</span>
					</button>
				</li>
			{/each}
		</ol>
	</div>
{/if}

{#if remote}
	<!-- The facilitator runs this from their console. -->
{:else if recordRpe}
	<div class="facil" class:done={status === 'saved'}>
		{#if !open}
			<button class="toggle" onclick={() => (open = true)}>
				Facilitator: {status === 'saved' ? `RPE ${rpe}${peak ? ` · peak HR ${peak}` : ''} saved ✓` : 'record RPE at end of bout ▸'}
			</button>
		{:else}
			<p class="head">
				<b>End of bout:</b> show the Borg scale and ask "How hard did that feel?", then tap the number.
				<button class="show" onclick={() => (showCard = true)}>Show Borg scale to participant</button>
				<button class="close" onclick={() => (open = false)}>hide</button>
			</p>
			<div class="borg">
				{#each LEVELS as n (n)}
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
{:else}
	<div class="facil quiet">
		Facilitator: no RPE for this condition. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to {durationMs > 0 && startedAt === null ? 'start the timer' : `continue${durationMs > 0 && !timeUp ? ' (twice to skip the timer)' : ''}`}.
	</div>
{/if}

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
	.metro {
		margin: 1.5rem 0 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
	}
	.beat {
		width: min(18rem, 40vh);
		aspect-ratio: 1;
		border-radius: 50%;
		background: #1f63d6;
		color: white;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		box-shadow: 0 0 0 0 rgba(31, 99, 214, 0.45);
		transform: scale(0.92);
		opacity: 0.55;
		transition:
			transform 220ms ease-out,
			opacity 220ms ease-out,
			box-shadow 260ms ease-out;
	}
	.beat.on {
		transform: scale(1);
		opacity: 1;
		box-shadow: 0 0 0 1.6rem rgba(31, 99, 214, 0.15);
		transition: none;
	}
	.beat.idle {
		background: #bbb;
		opacity: 1;
	}
	.step {
		font-size: 4rem;
		font-weight: 800;
		line-height: 1;
	}
	.tempo {
		margin-top: 0.4rem;
		font-size: 1.2rem;
		font-weight: 600;
		opacity: 0.85;
	}
	.metro-hint {
		margin: 0;
		font-size: 1.4rem;
		color: #555;
	}
	.mute,
	.unlock {
		font-size: 1rem;
		padding: 0.3rem 0.9rem;
		border-radius: 6px;
		border: 1px solid #bbb;
		background: white;
		cursor: pointer;
	}
	.unlock {
		font-size: 1.4rem;
		font-weight: 700;
		border: 2px solid #c0392b;
		color: #c0392b;
		background: #fff3f1;
	}
	.clock {
		margin: 2rem 0 0;
		font-size: 7rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: #1f63d6;
		line-height: 1;
	}
	.clock.idle {
		color: #999;
	}
	.start {
		margin-top: 1.5rem;
		font-size: 2.2rem;
		font-weight: 700;
		padding: 0.6rem 3rem;
		border-radius: 12px;
		border: none;
		background: #2a9d3f;
		color: white;
		cursor: pointer;
	}
	.start:disabled {
		opacity: 0.6;
	}
	.up {
		margin: 2rem 0 0;
		font-size: 4rem;
		font-weight: 800;
		color: #2a9d3f;
	}
	.wait {
		margin-top: 2rem;
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
	.facil.quiet {
		background: #f6f6f6;
		border-color: #ccc;
		color: #555;
		font-size: 0.95rem;
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
	.show {
		margin-left: 0.8rem;
		font-size: 1rem;
		padding: 0.25rem 0.8rem;
		border-radius: 6px;
		border: 2px solid #1f63d6;
		background: #1f63d6;
		color: white;
		font-weight: 600;
		cursor: pointer;
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

	/* Full-screen Borg card shown to the participant */
	.card {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: white;
		display: flex;
		flex-direction: column;
		padding: 1rem 2rem;
		box-sizing: border-box;
	}
	.card header {
		text-align: center;
		position: relative;
	}
	.card h2 {
		font-size: 2.2rem;
		margin: 0.2rem 0;
	}
	.card header p {
		margin: 0 0 0.6rem;
		font-size: 1.2rem;
		color: #555;
	}
	.cardclose {
		position: absolute;
		top: 0;
		right: 0;
		font-size: 1rem;
		background: none;
		border: 1px solid #bbb;
		border-radius: 6px;
		padding: 0.2rem 0.6rem;
		cursor: pointer;
	}
	.scale {
		list-style: none;
		margin: 0 auto;
		padding: 0;
		flex: 1;
		width: min(100%, 52rem);
		display: grid;
		grid-template-rows: repeat(15, 1fr);
		gap: 3px;
	}
	.scale button {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 4rem 16rem 1fr;
		align-items: center;
		text-align: left;
		gap: 1rem;
		padding: 0 1rem;
		border: 3px solid transparent;
		border-radius: 6px;
		background: hsl(var(--h) 70% 88%);
		cursor: pointer;
		font: inherit;
		color: #111;
	}
	.scale button.sel {
		border-color: #111;
	}
	.scale b {
		font-size: 1.8rem;
		text-align: right;
	}
	.scale .anchor {
		font-size: 1.4rem;
		font-weight: 700;
	}
	.scale .hint {
		font-size: 1.05rem;
		color: #333;
	}
</style>

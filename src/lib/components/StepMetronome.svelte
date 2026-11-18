<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { BEATS_PER_CYCLE, Metronome, SOUNDS, audioReady, primeAudio, unlockAudio, type SoundId } from '$lib/client/metronome';

	/**
	 * Harvard step test metronome: a big circle that flashes on each click (Up, Up, Down, Down;
	 * the first Up is accented), tempo slider + number box, click-sound picker and mute.
	 * Exercise screen: `running` follows the countdown and `anchorMs` locks the clicks to its
	 * seconds. Baseline (`playPause`): a Play / Pause button so the facilitator can demonstrate.
	 */
	let {
		defaultBpm,
		running = false,
		anchorMs = undefined,
		playPause = false,
		compact = false
	}: {
		/** Configured step-test tempo; the screen starts here and can reset to it. */
		defaultBpm: number;
		/** Clicking now (ignored with `playPause`, which has its own button). */
		running?: boolean;
		/** This computer's Date.now() for beat 0 (the countdown start). */
		anchorMs?: number;
		/** Show a Play / Pause button instead of following `running`. */
		playPause?: boolean;
		/** Smaller circle, for screens with other content. */
		compact?: boolean;
	} = $props();

	const STEPS = ['Up', 'Up', 'Down', 'Down'];
	const BPM_MIN = 40;
	const BPM_MAX = 200;
	let playing = $state(false);
	const ticking = $derived(playPause ? playing : running);
	let muted = $state(false);
	let pulse = $state(false);
	let beat = $state(-1);
	let met: Metronome | null = null;
	let now = $state(Date.now());

	onMount(() => {
		primeAudio();
		const t = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(t);
	});

	// svelte-ignore state_referenced_locally
	let bpm = $state(defaultBpm);
	let bpmText = $state('');
	$effect(() => {
		bpmText = String(bpm);
	});
	function setBpm(v: number) {
		if (Number.isFinite(v)) bpm = Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, v)));
		bpmText = String(bpm);
	}

	/** Click sound, remembered on this computer. */
	const SOUND_KEY = 'concentration-sa.metronome-sound';
	let sound = $state<SoundId>('woodblock');
	try {
		const v = localStorage.getItem(SOUND_KEY);
		if (SOUNDS.some((x) => x.id === v)) sound = v as SoundId;
	} catch {
		// storage blocked: default sound
	}
	const previewer = new Metronome(120);
	function pickSound(id: SoundId) {
		sound = id;
		try {
			localStorage.setItem(SOUND_KEY, id);
		} catch {
			// not remembered
		}
		if (!ticking) previewer.preview(id, true);
	}

	// Re-checked every 250 ms: has the browser let the page make sound yet?
	const soundBlocked = $derived(ticking && !muted && now > 0 && !audioReady());

	$effect(() => {
		if (!ticking) return;
		const m = new Metronome(untrack(() => bpm), (b) => {
			beat = b;
			pulse = true;
			setTimeout(() => (pulse = false), 120);
		});
		m.muted = untrack(() => muted);
		m.sound = untrack(() => sound);
		met = m;
		m.start(untrack(() => (playPause ? undefined : anchorMs)));
		return () => {
			m.stop();
			met = null;
			beat = -1;
		};
	});
	$effect(() => {
		const [mu, so, b] = [muted, sound, bpm];
		if (met) {
			met.muted = mu;
			met.sound = so;
			met.bpm = b;
		}
	});
</script>

<div class="metro" class:compact>
	<div class="beat" class:on={pulse && ticking} class:accent={ticking && beat % BEATS_PER_CYCLE === 0} class:idle={!ticking}>
		<span class="step">{ticking && beat >= 0 ? STEPS[beat % BEATS_PER_CYCLE] : 'Step'}</span>
		<span class="tempo">{bpm} BPM</span>
	</div>
	<p class="metro-hint">Step with each click: up, up, down, down.</p>
	{#if playPause}
		<button class="play" class:on={playing} onclick={() => (unlockAudio(), (playing = !playing))}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
	{/if}
	{#if soundBlocked}
		<button class="unlock" onclick={() => unlockAudio()}>🔈 Tap here to turn on the sound</button>
	{/if}
	<div class="controls">
		<label class="tempo-ctl">
			<span>Tempo</span>
			<input type="range" min={BPM_MIN} max={BPM_MAX} step="1" value={bpm} oninput={(e) => setBpm(e.currentTarget.valueAsNumber)} aria-label="Tempo (beats per minute)" />
			<input
				class="bpm-num"
				type="number"
				min={BPM_MIN}
				max={BPM_MAX}
				inputmode="numeric"
				bind:value={bpmText}
				onchange={(e) => setBpm(e.currentTarget.valueAsNumber)}
				onkeydown={(e) => e.key === 'Enter' && setBpm(e.currentTarget.valueAsNumber)}
				aria-label="Beats per minute"
			/>
			<span>BPM</span>
			{#if bpm !== defaultBpm}<button class="reset" onclick={() => setBpm(defaultBpm)}>Reset to {defaultBpm}</button>{/if}
		</label>
		<div class="sounds" role="radiogroup" aria-label="Click sound">
			{#each SOUNDS as s (s.id)}
				<button role="radio" aria-checked={sound === s.id} class:sel={sound === s.id} onclick={() => pickSound(s.id)}>{s.label}</button>
			{/each}
			<button class="mute" onclick={() => (muted = !muted)}>{muted ? '🔇 Off' : '🔊 On'}</button>
		</div>
	</div>
</div>

<style>
	.metro {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(0.3rem, 1.2vh, 0.8rem);
		min-height: 0;
	}
	.beat {
		width: min(36vh, 70vw);
		aspect-ratio: 1;
		container-type: size;
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
	.beat.accent {
		background: #e0712a;
	}
	.beat.on {
		transform: scale(1);
		opacity: 1;
		box-shadow: 0 0 0 min(3vh, 1.6rem) rgba(31, 99, 214, 0.15);
		transition: none;
	}
	.beat.idle {
		background: #bbb;
		opacity: 1;
	}
	.step {
		font-size: 24cqw;
		font-weight: 800;
		line-height: 1;
	}
	.tempo {
		margin-top: 3cqw;
		font-size: 8cqw;
		font-weight: 600;
		opacity: 0.85;
	}
	.metro-hint {
		margin: 0;
		font-size: clamp(0.9rem, 2.4vh, 1.4rem);
		color: #555;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.5rem 1.5rem;
		font-size: clamp(0.85rem, 2vh, 1.05rem);
		color: #444;
	}
	.tempo-ctl {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.tempo-ctl input[type='range'] {
		width: min(16rem, 40vw);
	}
	.bpm-num {
		width: 4.2rem;
		font-size: 1em;
		text-align: center;
		margin: 0;
	}
	.sounds {
		display: flex;
		gap: 0.3rem;
	}
	.sounds button,
	.mute,
	.reset,
	.unlock {
		font-size: 1em;
		padding: 0.25rem 0.8rem;
		border-radius: 6px;
		border: 1px solid #bbb;
		background: white;
		cursor: pointer;
	}
	.sounds button.sel {
		background: #1f63d6;
		border-color: #1f63d6;
		color: white;
	}
	.mute {
		margin-left: 0.4rem;
	}
	.unlock {
		font-size: clamp(1rem, 2.6vh, 1.4rem);
		font-weight: 700;
		border: 2px solid #c0392b;
		color: #c0392b;
		background: #fff3f1;
	}
	.compact .beat {
		width: min(24vh, 50vw);
	}
	.play {
		font-size: clamp(1.1rem, 3vh, 1.5rem);
		font-weight: 700;
		padding: 0.35em 1.6em;
		border-radius: 10px;
		border: none;
		background: #2a9d3f;
		color: white;
		cursor: pointer;
	}
	.play.on {
		background: #555;
	}
</style>

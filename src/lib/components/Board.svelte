<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { nowTs } from '$lib/client/api';
	import { renderSpec } from '$lib/render';
	import type { BoardInfo } from '$lib/state';
	import type { ClickOutcome, ClickRecord, ColorOption, OrientationOption, ThemeManifest } from '$lib/types';
	import ObjectImage from './ObjectImage.svelte';

	interface Props {
		board: BoardInfo;
		manifest: ThemeManifest;
		colors: ColorOption[];
		orientations: OrientationOption[];
		previewMs: number;
		flipMs: number;
		/** Clicks already logged for this board (when resuming after a reload). */
		priorClicks?: ClickRecord[];
		/** True if the preview already finished before a reload. */
		resumed?: boolean;
		practice?: boolean;
		/** Play time allowed after the cards flip face down; 0 = no limit. */
		timeLimitMs?: number;
		/** Play time already used before a reload (resumed boards only). */
		elapsedMs?: number;
		/** Called once when the time limit runs out before the board is cleared. */
		onTimeout?: () => void;
		onMark?: (name: 'preview' | 'play', ts: number) => void;
		onFlip?: (c: ClickRecord) => void;
		onComplete: () => void;
	}
	let {
		board,
		manifest,
		colors,
		orientations,
		previewMs,
		flipMs,
		priorClicks = [],
		resumed = false,
		practice = false,
		timeLimitMs = 0,
		elapsedMs = 0,
		onTimeout,
		onMark,
		onFlip,
		onComplete
	}: Props = $props();

	// Props are read once on purpose: the board is re-created per phase.
	const { items, specs, initialCards, initialSeq } = untrack(() => init());
	function init() {
		const items = new Map(manifest.objects.map((o) => [o.id, o]));
		const specs = new Map(manifest.objects.map((o) => [o.id, renderSpec(board.theme, o, colors, orientations)]));
		// Rebuild matched cards from the log when resuming.
		const matchedIds = new Set(priorClicks.filter((c) => c.outcome === 'match').map((c) => c.object_id));
		const initialCards = board.cards.map((id, index) => ({ index, id, up: matchedIds.has(id), matched: matchedIds.has(id) }));
		const initialSeq = priorClicks.length ? Math.max(...priorClicks.map((c) => c.seq)) + 1 : 0;
		return { items, specs, initialCards, initialSeq };
	}
	let cards = $state(initialCards);
	let stage = $state<'ready' | 'preview' | 'play' | 'done'>(untrack(() => (resumed ? 'play' : 'ready')));
	let first = $state<number | null>(null);
	let locked = $state(false);
	let seq = initialSeq;
	let previewLeft = $state(untrack(() => Math.ceil(previewMs / 1000)));
	let hint = $state('');
	let timedOut = $state(false);
	let timeLeft = $state(untrack(() => Math.ceil(timeLimitMs / 1000)));
	const timeouts: ReturnType<typeof setTimeout>[] = [];
	let tick: ReturnType<typeof setInterval> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		if (practice) hint = 'This is a practice round. Press Start when you are ready.';
		if (resumed) {
			if (cards.every((c) => c.matched)) finish();
			else startClock(elapsedMs);
		}
	});
	onDestroy(() => {
		timeouts.forEach(clearTimeout);
		clearInterval(tick);
		clearInterval(clock);
	});

	/** Count down the play time; `used` is time already spent (after a reload). */
	function startClock(used: number) {
		if (!timeLimitMs) return;
		const end = performance.now() + timeLimitMs - used;
		const update = () => {
			const left = end - performance.now();
			timeLeft = Math.max(0, Math.ceil(left / 1000));
			if (left <= 0) timeUp();
		};
		update();
		if (stage === 'play') clock = setInterval(update, 200);
	}

	function timeUp() {
		clearInterval(clock);
		if (stage === 'done') return;
		stage = 'done';
		timedOut = true;
		first = null;
		if (practice) hint = "Time's up! Practice complete. Please wait for the researcher.";
		timeouts.push(setTimeout(() => onTimeout?.(), practice ? 0 : 1500));
	}

	/** The clock stays hidden until the last few seconds, so it adds as little time pressure as possible. */
	const WARN_S = 5;

	function start() {
		stage = 'preview';
		cards.forEach((c) => (c.up = true));
		const t0 = nowTs();
		onMark?.('preview', t0);
		if (practice) hint = 'All the cards are shown face up for a few seconds. Then they turn over.';
		const end = performance.now() + previewMs;
		tick = setInterval(() => {
			previewLeft = Math.max(0, Math.ceil((end - performance.now()) / 1000));
		}, 100);
		timeouts.push(
			setTimeout(() => {
				clearInterval(tick);
				cards.forEach((c) => (c.up = c.matched));
				stage = 'play';
				onMark?.('play', nowTs());
				if (practice) hint = 'Click a card to turn it over.';
				startClock(0);
			}, previewMs)
		);
	}

	function log(index: number, outcome: ClickOutcome, ts: number) {
		onFlip?.({ seq: seq++, card_index: index, object_id: cards[index].id, outcome, client_ts: ts });
	}

	function click(index: number) {
		const ts = nowTs();
		const card = cards[index];
		if (stage !== 'play' || locked || card.up) return;
		card.up = true;
		if (first === null) {
			first = index;
			log(index, 'first_flip', ts);
			if (practice) hint = 'Now click another card to find its match.';
			return;
		}
		const a = cards[first];
		first = null;
		if (a.id === card.id) {
			a.matched = card.matched = true;
			log(index, 'match', ts);
			if (practice) hint = 'A match! Matched cards stay face up. Keep going.';
			if (cards.every((c) => c.matched)) finish();
		} else {
			log(index, 'mismatch', ts);
			if (practice) hint = 'Not a match. Both cards turn back over. Try to remember where they were.';
			locked = true;
			timeouts.push(
				setTimeout(() => {
					a.up = false;
					card.up = false;
					locked = false;
				}, flipMs)
			);
		}
	}

	function finish() {
		clearInterval(clock);
		if (stage === 'done') return;
		stage = 'done';
		if (practice) hint = 'Practice complete. Please wait for the researcher.';
		timeouts.push(setTimeout(onComplete, practice ? 0 : 1200));
	}
</script>

<div class="wrap">
	<h1>Match the objects.</h1>
	{#if practice}
		<p class="hint" aria-live="polite">{hint}</p>
	{/if}

	<div class="board" style:--rows={board.rows} style:--cols={board.cols}>
		{#each cards as card (card.index)}
			<button
				class="card"
				class:up={card.up}
				class:matched={card.matched}
				disabled={stage !== 'play' || locked || card.up}
				onpointerdown={() => click(card.index)}
				aria-label={card.up ? items.get(card.id)?.label : 'face-down card'}
			>
				<div class="inner">
					<div class="face back"></div>
					<div class="face front">
						<ObjectImage spec={specs.get(card.id)!} size="72%" />
					</div>
				</div>
			</button>
		{/each}

		{#if stage === 'ready'}
			<div class="overlay">
				<button class="big" onclick={start}>Start</button>
			</div>
		{/if}
	</div>

	{#if stage === 'play' && timeLimitMs && timeLeft <= WARN_S}
		<div class="clock" aria-live="polite">{timeLeft}</div>
	{/if}

	<p class="status">
		{#if stage === 'preview'}
			Cards turn over in {previewLeft}
		{:else if stage === 'done' && timedOut}
			Time's up!
		{:else if stage === 'done' && !practice}
			Done!
		{/if}
	</p>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem;
	}
	h1 {
		margin: 0;
		font-size: 1.8rem;
	}
	.hint {
		margin: 0;
		min-height: 1.5em;
		font-size: 1.25rem;
		color: #234;
		background: #eef4ff;
		padding: 0.4rem 1rem;
		border-radius: 8px;
	}
	.status {
		margin: 0;
		min-height: 1.5em;
		font-size: 1.4rem;
		font-weight: 600;
	}
	/* Last-seconds warning, top right (below the test toolbar). */
	.clock {
		position: fixed;
		top: 2.4rem;
		right: 1.2rem;
		min-width: 2.4rem;
		padding: 0.2rem 0.6rem;
		border-radius: 8px;
		background: #fdecea;
		color: #c0392b;
		font-size: 1.6rem;
		font-weight: 700;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.board {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 1.2vmin;
		width: min(92vw, calc((100vh - 11rem) * var(--cols) / var(--rows)));
	}
	.card {
		aspect-ratio: 1;
		padding: 0;
		border: none;
		background: none;
		perspective: 800px;
		cursor: pointer;
		touch-action: manipulation;
	}
	/* Face-up and matched cards are disabled buttons. Browsers grey out disabled buttons
	   (Chrome sets a GrayText color, which tints emoji; Safari lowers the opacity), so undo that. */
	.card:disabled {
		cursor: default;
		color: inherit;
		-webkit-text-fill-color: currentColor;
		opacity: 1;
	}
	.inner {
		position: relative;
		width: 100%;
		height: 100%;
		transition: transform 0.3s;
		transform-style: preserve-3d;
	}
	.card.up .inner {
		transform: rotateY(180deg);
	}
	.face {
		position: absolute;
		inset: 0;
		border-radius: 10px;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.back {
		background: repeating-linear-gradient(45deg, #2c3e66 0 10px, #34497a 10px 20px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
	}
	.front {
		background: #fafafa;
		border: 2px solid #ccc;
		transform: rotateY(180deg);
	}
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.6);
	}
	.big {
		font-size: 2rem;
		padding: 1rem 3rem;
		border-radius: 12px;
		border: none;
		background: #1f63d6;
		color: white;
		cursor: pointer;
	}
</style>

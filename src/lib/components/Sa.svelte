<script lang="ts">
	import { nowTs } from '$lib/client/api';
	import { renderSpec } from '$lib/render';
	import type { SaStep } from '$lib/sa-plan';
	import { DONT_REMEMBER, LEVEL2_NEUTRAL_HEX, type ColorOption, type OralQuestion, type OrientationOption, type ThemeManifest } from '$lib/types';
	import Confidence from './Confidence.svelte';
	import ObjectImage from './ObjectImage.svelte';

	interface Props {
		plan: SaStep[];
		answered: number;
		manifests: Record<string, ThemeManifest>;
		colors: ColorOption[];
		orientations: OrientationOption[];
		scale: number;
		labels: [string, string];
		oralQuestions?: OralQuestion[];
		/** Neutral color for Level 2 color-pair options. */
		level2Hex?: string;
		onAnswer: (a: Record<string, unknown>) => Promise<unknown>;
		onDone: () => void;
	}
	let { plan, answered, manifests, colors, orientations, scale, labels, oralQuestions = [], level2Hex = LEVEL2_NEUTRAL_HEX, onAnswer, onDone }: Props = $props();

	// Props are read once on purpose: the component is re-created per phase.
	// svelte-ignore state_referenced_locally
	let index = $state(answered);
	let shownAt = $state(nowTs());
	let response = $state<string | null>(null);
	let confidence = $state<number | null>(null);
	let answerAt = 0;
	let confidenceAt = 0;
	let answerChanges = 0;
	let confidenceChanges = 0;
	let selectedAt = 0;
	let selected = $state<string[]>([]);
	let busy = $state(false);

	const step = $derived(plan[index]);
	const manifest = $derived(step && step.type !== 'oral' ? manifests[step.theme] : null);
	const oral = $derived(step?.type === 'oral' ? oralQuestions.find((q) => q.id === step.item) : undefined);
	/** "I don't remember": no confidence rating. */
	const special = $derived(response === DONT_REMEMBER);
	/** Environment questions are marked by the facilitator: no confidence rating. */
	const needConf = $derived(scale > 0 && !special && step?.type !== 'oral');
	/** The facilitator has unlocked the environment-question controls (Ctrl+Shift+F). Stays on for the rest of them. */
	let facilitator = $state(false);

	function onKey(e: KeyboardEvent) {
		if (e.ctrlKey && e.shiftKey && e.code === 'KeyF' && step?.type === 'oral') {
			e.preventDefault();
			facilitator = true;
		}
	}
	const find = (id: string) => [...manifest!.objects, ...manifest!.foils].find((o) => o.id === id)!;
	const nTargets = $derived(manifest?.objects.length ?? 0);

	$effect(() => {
		if (index >= plan.length) onDone();
	});

	function next() {
		index++;
		response = null;
		confidence = null;
		answerChanges = confidenceChanges = 0;
		selected = [];
		shownAt = nowTs();
		busy = false;
	}

	async function submit(payload: Record<string, unknown>) {
		busy = true;
		const p = onAnswer({ seq: step.seq, client_ts: nowTs(), ...payload });
		// Move on right away; the queue keeps retrying in the background.
		p.catch(() => {});
		next();
	}

	// Answers and confidence can be changed freely until Submit.
	function pick(r: string) {
		if (response !== null && response !== r) answerChanges++;
		answerAt = nowTs();
		response = r;
	}

	function pickConfidence(n: number) {
		if (confidence !== null && confidence !== n) confidenceChanges++;
		confidenceAt = nowTs();
		confidence = n;
	}

	function submitItem() {
		const t = nowTs();
		submit({
			response,
			confidence: needConf ? confidence : null,
			rt_ms: answerAt - shownAt,
			confidence_rt_ms: needConf ? confidenceAt - shownAt : null,
			submit_rt_ms: t - shownAt,
			answer_changes: answerChanges,
			confidence_changes: confidenceChanges
		});
	}

	function submitGrid() {
		const t = nowTs();
		submit({ response: selected, rt_ms: selectedAt - shownAt, submit_rt_ms: t - shownAt, answer_changes: answerChanges });
	}

	function toggle(id: string) {
		if (selected.includes(id)) {
			selected = selected.filter((x) => x !== id);
			answerChanges++;
		} else if (selected.length < nTargets) selected = [...selected, id];
		selectedAt = nowTs();
	}
</script>

{#snippet extras()}
	<div class="extras">
		<button class="extra" class:sel={response === DONT_REMEMBER} onclick={() => pick(DONT_REMEMBER)}>I don't remember</button>
	</div>
{/snippet}

{#snippet finish()}
	{#if needConf}<Confidence {scale} {labels} value={confidence} onPick={pickConfidence} />{/if}
	<button class="go" disabled={response === null || (needConf && confidence === null) || busy} onclick={submitItem}>Next</button>
{/snippet}

<svelte:window onkeydown={onKey} />

{#if step && step.type === 'oral'}
	{#key step.seq}
		<div class="sa">
			{#if !facilitator}
				<h2 class="talk">Please stand up and talk to your facilitator, who will ask you some questions about the environment.</h2>
				<p class="hint">Facilitator: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></p>
			{:else}
				<p class="progress">Environment question {index + 1 - plan.findIndex((p) => p.type === 'oral')} of {plan.filter((p) => p.type === 'oral').length}</p>
				<p class="facil">Facilitator: ask the question and read the choices, then mark the answer.</p>
				<h2>{oral?.prompt ?? `Missing question "${step.item}"`}</h2>
				{#if oral?.options.length}<p class="read">{oral.options.map((o) => o.label).join(' · ')}</p>{/if}
				<div class="choices">
					<button class="choice" class:sel={response === 'correct'} onclick={() => pick('correct')}>Correct</button>
					<button class="choice" class:sel={response === 'incorrect'} onclick={() => pick('incorrect')}>Incorrect</button>
				</div>
				<div class="extras">
					<button class="extra" class:sel={response === DONT_REMEMBER} onclick={() => pick(DONT_REMEMBER)}>Didn't remember</button>
				</div>
				{@render finish()}
			{/if}
		</div>
	{/key}
{:else if step && manifest}
	{#key step.seq}
		<div class="sa">
			<p class="progress">Question {index + 1} of {plan.length}</p>

			{#if step.type === 'objects'}
				<h2>Tap the {nTargets} you saw</h2>
				<div class="grid">
					{#each step.items as id (id)}
						<button class="opt" class:sel={selected.includes(id)} onclick={() => toggle(id)}>
							<ObjectImage spec={renderSpec(step.theme, find(id), colors, orientations)} size="80%" />
						</button>
					{/each}
				</div>
				<button
					class="go"
					disabled={selected.length !== nTargets || busy}
					onclick={submitGrid}
				>
					Next ({selected.length}/{nTargets})
				</button>
			{:else if step.type === 'level2_color'}
				<h2>{step.prompt}</h2>
				<div class="row">
					{#each step.options as id (id)}
						<button class="opt big" class:sel={response === id} onclick={() => pick(id)}>
							<ObjectImage spec={renderSpec(step.theme, find(id), colors, orientations, { hex: level2Hex })} size="80%" />
						</button>
					{/each}
				</div>
				{@render extras()}
				{@render finish()}
			{:else if step.type === 'level2_count'}
				<h2>{step.prompt}</h2>
				<div class="choices">
					{#each step.options as o (o.id)}
						<button class="choice" class:sel={response === o.id} onclick={() => pick(o.id)}>{o.label}</button>
					{/each}
				</div>
				{@render extras()}
				{@render finish()}
			{:else}
				{@const item = find(step.item)}
				{#if step.type === 'color'}
					<h2>What color was the {item.label}?</h2>
					<div class="row">
						{#each colors as c (c.id)}
							<button class="opt big" class:sel={response === c.id} onclick={() => pick(c.id)}>
								<ObjectImage spec={renderSpec(step.theme, item, colors, orientations, { color: c.id })} size="80%" />
								<span>{c.label}</span>
							</button>
						{/each}
					</div>
					{@render extras()}
				{:else if step.type === 'orientation'}
					<h2>Which way did the {item.label} face?</h2>
					<div class="row">
						{#each orientations as o (o.id)}
							<button class="opt big" class:sel={response === o.id} onclick={() => pick(o.id)}>
								<ObjectImage spec={renderSpec(step.theme, item, colors, orientations, { orientation: o.id })} size="80%" />
							</button>
						{/each}
					</div>
					{@render extras()}
				{:else if step.type === 'side_by_side'}
					<h2>Which one did you see?</h2>
					<div class="row">
						{#each ['left', 'right'] as side (side)}
							<button class="opt big" class:sel={response === side} onclick={() => pick(side)}>
								<ObjectImage
									spec={renderSpec(step.theme, item, colors, orientations, { variant: step.original_side !== side })}
									size="80%"
								/>
							</button>
						{/each}
					</div>
					{@render extras()}
				{/if}
				{@render finish()}
			{/if}
		</div>
	{/key}
{/if}

<style>
	.sa {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.5rem;
	}
	.progress {
		color: #777;
		margin: 0;
	}
	h2 {
		font-size: 2rem;
		text-align: center;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.8rem;
		width: min(90vw, calc(100vh - 14rem));
	}
	.row {
		display: flex;
		gap: 1.2rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.opt {
		aspect-ratio: 1;
		background: #fafafa;
		border: 3px solid #ccc;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}
	.opt.big {
		width: min(20vw, 30vh);
	}
	.opt span {
		font-size: 1.1rem;
	}
	.opt.sel {
		border-color: #1f63d6;
		background: #eef4ff;
		box-shadow: 0 0 0 3px #1f63d6;
	}
	.extras {
		display: flex;
		gap: 0.8rem;
		margin-top: 1rem;
	}
	.extra {
		font-size: 1.1rem;
		padding: 0.45rem 1.2rem;
		border: 2px solid #ccc;
		border-radius: 8px;
		background: white;
		color: #444;
		cursor: pointer;
	}
	.extra.sel,
	.choice.sel {
		border-color: #1f63d6;
		background: #eef4ff;
		box-shadow: 0 0 0 2px #1f63d6;
	}
	.talk {
		max-width: 40rem;
		margin-top: 20vh;
		line-height: 1.3;
	}
	.hint {
		color: #aaa;
		font-size: 0.9rem;
		margin-top: 3rem;
	}
	.read {
		font-size: 1.3rem;
		color: #555;
		margin-top: 0;
	}
	.facil {
		background: #fff4cc;
		border-radius: 8px;
		padding: 0.4rem 1rem;
		font-weight: 600;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		justify-content: center;
		max-width: 50rem;
	}
	.choice {
		font-size: 1.4rem;
		padding: 0.8rem 1.6rem;
		min-width: 8rem;
		border: 3px solid #ccc;
		border-radius: 10px;
		background: #fafafa;
		cursor: pointer;
	}
	.go {
		margin-top: 1rem;
		font-size: 1.4rem;
		padding: 0.7rem 2rem;
		border-radius: 10px;
		border: none;
		background: #1f63d6;
		color: white;
		cursor: pointer;
	}
	.go:disabled {
		background: #9ab;
		cursor: default;
	}
</style>

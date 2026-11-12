<script lang="ts">
	import { onMount } from 'svelte';
	import { renderSpec, type RenderSpec } from '$lib/render';
	import type { ManifestItem } from '$lib/types';
	import ObjectImage from '$lib/components/ObjectImage.svelte';
	import { hasVariant } from '$lib/sa-plan';
	import Sa from '$lib/components/Sa.svelte';
	import Survey from '$lib/components/Survey.svelte';

	let { data } = $props();

	type Decision = 'keep' | 'candidate' | 'other' | '';
	interface ItemFb {
		decision: Decision;
		candidate?: string;
		render?: 'mask' | 'original';
		comment: string;
	}
	interface Feedback {
		items: Record<string, ItemFb>;
		questions: { per_theme: number | null; foils: number | null; confidence: 'keep' | 'off' | ''; comment: string };
		survey: { comment: string };
		general: string;
	}

	const DRAFT_KEY = 'preview-feedback-draft';
	const blank = (): Feedback => ({
		items: {},
		questions: {
			per_theme: data.authed ? data.settings.sa_random_per_theme : null,
			foils: data.authed ? data.settings.sa_foils_per_theme : null,
			confidence: '',
			comment: ''
		},
		survey: { comment: '' },
		general: ''
	});
	// svelte-ignore state_referenced_locally
	let fb = $state<Feedback>(withAllItems(data.authed && data.feedback ? { ...blank(), ...data.feedback } : blank()));
	let tab = $state<'icons' | 'questions' | 'survey'>('icons');
	let status = $state('');
	let saving = $state(false);
	let saKey = $state(0);
	let surveyKey = $state(0);

	onMount(() => {
		try {
			const d = localStorage.getItem(DRAFT_KEY);
			if (d && !data.feedback) fb = withAllItems({ ...blank(), ...JSON.parse(d) });
		} catch {
			/* no storage */
		}
	});
	$effect(() => {
		const snapshot = JSON.stringify(fb);
		try {
			localStorage.setItem(DRAFT_KEY, snapshot);
		} catch {
			/* no storage */
		}
	});

	function key(theme: string, id: string) {
		return `${theme}/${id}`;
	}
	/** Make sure every item has an entry (state cannot be created while rendering). */
	function withAllItems(f: Feedback): Feedback {
		if (!data.authed) return f;
		for (const t of data.themes) {
			for (const o of [...data.manifests[t].objects, ...data.manifests[t].foils]) {
				f.items[key(t, o.id)] ??= { decision: '', comment: '' };
			}
		}
		return f;
	}
	const itemFb = (theme: string, id: string): ItemFb => fb.items[key(theme, id)];

	function spec(theme: string, item: ManifestItem, variant = false): RenderSpec {
		if (!data.authed) throw new Error();
		return renderSpec(theme, item, data.colors, data.orientations, { variant });
	}
	function candSpec(theme: string, item: ManifestItem, c: { file: string; render: string }): RenderSpec {
		if (!data.authed) throw new Error();
		const src = `/preview/candidates/${theme}/${item.id}/${encodeURIComponent(c.file)}`;
		if (c.render === 'original') return { src, original: true, hex: 'transparent', transform: 'none' };
		const hex = data.colors.find((col) => col.id === item.color)?.hex ?? '#333';
		return { src, hex, transform: 'none' };
	}

	function pickCandidate(theme: string, id: string, file: string, render: 'mask' | 'original') {
		const f = itemFb(theme, id);
		if (f.candidate === file) {
			f.candidate = undefined;
			f.render = undefined;
			if (f.decision === 'candidate') f.decision = '';
		} else {
			f.candidate = file;
			f.render = render;
			f.decision = 'candidate';
		}
	}

	const total = $derived(
		data.authed ? data.themes.reduce((n, t) => n + data.manifests[t].objects.length + data.manifests[t].foils.length, 0) : 0
	);
	const reviewed = $derived(Object.values(fb.items).filter((f) => f.decision).length);

	async function save() {
		saving = true;
		status = '';
		try {
			const r = await fetch('/preview/feedback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(fb)
			});
			const out = await r.json().catch(() => ({}));
			status = r.ok ? `Saved ${new Date().toLocaleTimeString()} → data/preview-feedback.json` : `Save failed: ${out.message ?? r.statusText}`;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Preview &amp; feedback</title></svelte:head>

{#if !data.authed}
	<main class="narrow">
		<h1>Preview &amp; feedback</h1>
		<p>Log in at <a href="/admin">/admin</a> first, then come back here.</p>
	</main>
{:else}
	<header>
		<div class="title">
			<h1>Preview &amp; feedback</h1>
			<nav>
				<button class:on={tab === 'icons'} onclick={() => (tab = 'icons')}>Icons ({reviewed}/{total})</button>
				<button class:on={tab === 'questions'} onclick={() => (tab = 'questions')}>Questions</button>
				<button class:on={tab === 'survey'} onclick={() => (tab = 'survey')}>Survey</button>
			</nav>
		</div>
		<div class="savebox">
			{#if status}<span class="status">{status}</span>{/if}
			<button class="save" disabled={saving} onclick={save}>Save feedback</button>
			<a href="/admin">Admin</a>
		</div>
	</header>

	<main>
		{#if tab === 'icons'}
			<p class="intro">
				Each row shows the icon <b>as it appears on the card now</b> and its altered "side-by-side" variant. Click an
				alternative to choose it. <span class="chip mask">recolor</span> alternatives get the object's assigned color and
				work with color questions. <span class="chip orig">as-is</span> alternatives (emoji art, photos) keep their own
				colors, so color questions skip them. Then pick a decision and add a note if needed.
			</p>
			{#each data.themes as theme (theme)}
				{@const m = data.manifests[theme]}
				<h2>{m.label ?? theme}</h2>
				{#each [...m.objects.map((o) => ({ o, role: 'board' })), ...m.foils.map((o) => ({ o, role: 'foil' }))] as { o, role } (o.id)}
					{@const f = itemFb(theme, o.id)}
					{@const cands = data.candidates[theme]?.[o.id] ?? []}
					<article class:done={!!f.decision}>
						<div class="meta">
							<h3>{o.label}</h3>
							<p>
								<span class="chip">{role === 'board' ? 'on board' : 'foil (grid only)'}</span>
								{#if o.render === 'original'}<span class="chip orig">as-is</span>{:else}
									<span class="chip" style:background={data.colors.find((c) => c.id === o.color)?.hex} style:color="white">{o.color}</span>
								{/if}
							</p>
							<p class="file">{o.image}</p>
						</div>
						<div class="current">
							<figure>
								<div class="tile big"><ObjectImage spec={spec(theme, o)} size="72%" /></div>
								<figcaption>current</figcaption>
							</figure>
							{#if role === 'board' && hasVariant(o)}
								<figure>
									<div class="tile"><ObjectImage spec={spec(theme, o, true)} size="72%" /></div>
									<figcaption>variant</figcaption>
								</figure>
							{:else}
								<figure>
									<div class="tile none">{role === 'board' ? 'no side-by-side question' : 'foils have no variant'}</div>
									<figcaption>variant</figcaption>
								</figure>
							{/if}
						</div>
						<div class="cands">
							{#if !cands.length}<p class="muted">No alternatives fetched.</p>{/if}
							{#each cands as c (c.file)}
								<button
									class="tile cand"
									class:sel={f.candidate === c.file}
									title="{c.source} · {c.license}{c.author ? ' · ' + c.author : ''}"
									onclick={() => pickCandidate(theme, o.id, c.file, c.render)}
								>
									<ObjectImage spec={candSpec(theme, o, c)} size="78%" />
									<span class="badge {c.render === 'mask' ? 'mask' : 'orig'}">{c.render === 'mask' ? 'recolor' : 'as-is'}</span>
									{#if c.label}<span class="clabel">{c.label}</span>{/if}
								</button>
							{/each}
						</div>
						<div class="decide">
							<div class="seg">
								<button class:on={f.decision === 'keep'} onclick={() => (f.decision = 'keep')}>Keep</button>
								<button class:on={f.decision === 'candidate'} disabled={!f.candidate} onclick={() => (f.decision = 'candidate')}>Use selected</button>
								<button class:on={f.decision === 'other'} onclick={() => (f.decision = 'other')}>Need other</button>
							</div>
							<input placeholder="Note (optional)" bind:value={f.comment} />
						</div>
					</article>
				{/each}
			{/each}
		{:else if tab === 'questions'}
			<section class="panel">
				<h2>Question settings</h2>
				<p class="muted">
					Current: {data.settings.sa_questions.join(', ')} · {data.settings.sa_random_per_theme ?? 'all'} single questions per board ·
					{data.settings.sa_foils_per_theme ?? 'all'} foils in the grid · confidence scale {data.settings.confidence_scale || 'off'}
				</p>
				<div class="form">
					<label>Single questions per board <input type="number" min="0" max="8" bind:value={fb.questions.per_theme} /></label>
					<label>Foils in the "which did you see" grid <input type="number" min="0" max="8" bind:value={fb.questions.foils} /></label>
					<label>Confidence rating
						<select bind:value={fb.questions.confidence}>
							<option value="">no change</option>
							<option value="keep">keep</option>
							<option value="off">turn off</option>
						</select>
					</label>
				</div>
				<textarea placeholder="Comments on the questions (wording, length, layout…)" bind:value={fb.questions.comment}></textarea>
			</section>
			<section class="panel">
				<div class="row">
					<h2>Try the question flow</h2>
					<button onclick={() => saKey++}>Restart (new random draw)</button>
				</div>
				<p class="muted">This is the participant view. Answers here are not saved.</p>
				<div class="frame">
					{#key saKey}
						<Sa
							plan={data.demoPlan}
							answered={0}
							manifests={data.manifests}
							colors={data.colors}
							orientations={data.orientations}
							scale={fb.questions.confidence === 'off' ? 0 : data.confidenceScale}
							labels={data.confidenceLabels}
							oralQuestions={data.oralQuestions}
							onAnswer={async () => ({})}
							onDone={() => (status = 'Question demo finished. Press Restart to go again.')}
						/>
					{/key}
				</div>
			</section>
		{:else}
			<section class="panel">
				<h2>Survey (facilitator fills in)</h2>
				<textarea placeholder="Comments on the survey" bind:value={fb.survey.comment}></textarea>
				<div class="frame">
					{#key surveyKey}
						<Survey
							onSubmit={async () => {
								status = 'Survey demo: nothing saved.';
								surveyKey++;
							}}
						/>
					{/key}
				</div>
			</section>
		{/if}

		<section class="panel">
			<h2>Anything else?</h2>
			<textarea placeholder="General notes" bind:value={fb.general}></textarea>
			<button class="save" disabled={saving} onclick={save}>Save feedback</button>
			{#if status}<span class="status">{status}</span>{/if}
		</section>
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		background: #f5f6f8;
		color: #111;
	}
	.narrow {
		max-width: 40rem;
		margin: 3rem auto;
		padding: 0 1rem;
	}
	header {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		background: white;
		border-bottom: 1px solid #ddd;
		padding: 0.6rem 1.2rem;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	nav {
		display: flex;
		gap: 0.3rem;
	}
	nav button,
	.seg button {
		border: 1px solid #ccc;
		background: white;
		padding: 0.35rem 0.8rem;
		border-radius: 6px;
		cursor: pointer;
	}
	nav button.on,
	.seg button.on {
		background: #1f63d6;
		border-color: #1f63d6;
		color: white;
	}
	.savebox {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.save {
		background: #2a9d3f;
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.45rem 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.status {
		color: #2a6;
		font-size: 0.85rem;
	}
	main {
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem 1.2rem 4rem;
	}
	.intro {
		background: white;
		border-radius: 8px;
		padding: 0.8rem 1rem;
		line-height: 1.5;
	}
	h2 {
		margin: 1.4rem 0 0.6rem;
	}
	article {
		display: grid;
		grid-template-columns: 11rem auto 1fr;
		grid-template-areas: 'meta current cands' 'decide decide decide';
		gap: 0.6rem 1rem;
		background: white;
		border: 2px solid transparent;
		border-radius: 10px;
		padding: 0.8rem;
		margin-bottom: 0.6rem;
	}
	article.done {
		border-color: #bfe3c8;
	}
	.meta {
		grid-area: meta;
	}
	.meta h3 {
		margin: 0 0 0.3rem;
		font-size: 1.05rem;
	}
	.meta p {
		margin: 0.2rem 0;
	}
	.file {
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #888;
	}
	.current {
		grid-area: current;
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}
	figure {
		margin: 0;
		text-align: center;
	}
	figcaption {
		font-size: 0.75rem;
		color: #777;
	}
	.tile {
		width: 5rem;
		height: 5rem;
		border-radius: 10px;
		background: white;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
	}
	.tile.big {
		width: 7rem;
		height: 7rem;
	}
	.cands {
		grid-area: cands;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-content: flex-start;
	}
	.cand {
		border: 3px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.cand.sel {
		border-color: #1f63d6;
		box-shadow: 0 0 0 2px #1f63d6;
	}
	.tile.none {
		font-size: 0.65rem;
		color: #999;
		text-align: center;
		padding: 0.3rem;
		box-sizing: border-box;
		box-shadow: none;
		border: 1px dashed #ccc;
	}
	.clabel {
		position: absolute;
		top: 2px;
		left: 2px;
		right: 2px;
		font-size: 0.55rem;
		line-height: 1.1;
		background: rgb(255 255 255 / 0.85);
		border-radius: 3px;
		text-align: left;
	}
	.badge {
		position: absolute;
		bottom: 2px;
		right: 2px;
		font-size: 0.6rem;
		padding: 0 0.25rem;
		border-radius: 3px;
	}
	.chip {
		display: inline-block;
		font-size: 0.75rem;
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		background: #eee;
	}
	.mask {
		background: #e6efff;
		color: #1f4ea6;
	}
	.orig {
		background: #fdebd3;
		color: #8a4b00;
	}
	.decide {
		grid-area: decide;
		display: flex;
		gap: 0.8rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.seg {
		display: flex;
		gap: 0.25rem;
	}
	.seg button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.decide input {
		flex: 1;
		min-width: 12rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
	}
	.panel {
		background: white;
		border-radius: 10px;
		padding: 0.8rem 1.2rem 1.2rem;
		margin-top: 1rem;
	}
	.panel h2 {
		margin-top: 0.4rem;
	}
	.form {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2rem;
		margin-bottom: 0.8rem;
	}
	.form input {
		width: 4rem;
		margin-left: 0.4rem;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		min-height: 4.5rem;
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		font: inherit;
		margin-bottom: 0.6rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.frame {
		border: 2px dashed #ccc;
		border-radius: 10px;
		background: white;
		min-height: 30rem;
	}
	.muted {
		color: #777;
	}
	@media (max-width: 760px) {
		article {
			grid-template-columns: 1fr;
			grid-template-areas: 'meta' 'current' 'cands' 'decide';
		}
	}
</style>

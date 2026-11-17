<script lang="ts">
	import { untrack } from 'svelte';
	import type { Landing } from '$lib/landing';
	import LandingView from './LandingView.svelte';

	/** Admin editor for the public front page (/), with a live preview. */
	let { landing }: { landing: Landing } = $props();

	// A copy, so the admin page's 3 s refresh doesn't overwrite what's being typed.
	let draft = $state<Landing>(untrack(() => structuredClone($state.snapshot(landing))));
	let status = $state('');

	const addLink = () => (draft.links = [...draft.links, { label: '', url: '' }]);
	const removeLink = (i: number) => (draft.links = draft.links.filter((_, j) => j !== i));
	const move = (i: number, d: number) => {
		const l = [...draft.links];
		[l[i], l[i + d]] = [l[i + d], l[i]];
		draft.links = l;
	};

	async function save() {
		status = 'saving…';
		const r = await fetch('/admin/landing', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(draft)
		});
		const out = await r.json().catch(() => ({}));
		if (r.ok) {
			draft = out;
			status = `Saved ${new Date().toLocaleTimeString()}: live at /`;
		} else status = `Not saved: ${out.message ?? r.statusText}`;
	}
</script>

<svelte:head>
	<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<details class="landing">
	<summary><b>Front page &amp; sign-up links</b> <span class="muted small">({landing.links.length ? `${landing.links.length} sign-up link${landing.links.length > 1 ? 's' : ''} live` : 'sign-ups closed'})</span></summary>
	<div class="cols">
		<div class="form">
			<fieldset>
				<legend>Sign-up box</legend>
				<label>Date <span class="muted small">(shown first, e.g. Saturday, November 21 · 11 am – 4 pm)</span><input bind:value={draft.date} /></label>
				<div class="sub">Sign-up links <span class="muted small">(e.g. the Google Calendar booking page)</span></div>
				{#each draft.links as l, i (i)}
					<div class="link">
						<input placeholder="Button label, e.g. Book on Google Calendar" bind:value={l.label} />
						<input placeholder="https://calendar.app.google/…" bind:value={l.url} />
						<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
						<button title="Remove" onclick={() => removeLink(i)}>✕</button>
					</div>
				{/each}
				<button onclick={addLink}>+ Add link</button>
				<label>Note under the link <input bind:value={draft.signupNote} /></label>
				<label>Message when there are no links <input bind:value={draft.closed} /></label>
				<label>Contact email <input type="email" bind:value={draft.contact} /></label>
			</fieldset>
			<fieldset>
				<legend>Top of the page</legend>
				<div class="two">
					<label>Top left <input bind:value={draft.kicker} /></label>
					<label>Top right <input bind:value={draft.tag} /></label>
					<label>Headline line 1 <input bind:value={draft.title} /></label>
					<label>Headline line 2 (red) <input bind:value={draft.titleAccent} /></label>
				</div>
				<label
					>Text <span class="muted small">(blank line = new paragraph; start a line with • or - for a bullet)</span>
					<textarea rows="5" bind:value={draft.intro}></textarea>
				</label>
				<div class="sub">Rows <span class="muted small">(label and text, e.g. Time / About 20 minutes)</span></div>
				{#each draft.facts as f, i (i)}
					<div class="fact">
						<input placeholder="Label" bind:value={f.label} />
						<input placeholder="Text" bind:value={f.text} />
						<button title="Remove" onclick={() => (draft.facts = draft.facts.filter((_, j) => j !== i))}>✕</button>
					</div>
				{/each}
				<button onclick={() => (draft.facts = [...draft.facts, { label: '', text: '' }])}>+ Add row</button>
			</fieldset>
			<p><button class="save" onclick={save}>Save &amp; publish</button> <span class="small">{status}</span></p>
			<p class="muted small">Remove all links to close sign-ups. <a href="/" target="_blank">Open the live page →</a></p>
		</div>
		<div class="preview" aria-label="Preview">
			<LandingView landing={draft} />
		</div>
	</div>
</details>

<style>
	.landing {
		margin: 1rem 0 1.5rem;
		border: 1px solid #ccc;
		border-radius: 10px;
		padding: 0.6rem 1rem;
	}
	summary {
		cursor: pointer;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 0.8rem;
	}
	@media (max-width: 900px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-weight: 600;
		font-size: 0.9rem;
	}
	input,
	textarea {
		font: inherit;
		font-weight: 400;
		padding: 0.3rem 0.4rem;
	}
	fieldset {
		border: 1px solid #ddd;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	legend {
		font-weight: 700;
	}
	.link {
		display: grid;
		grid-template-columns: 10rem minmax(0, 1fr) auto auto;
		gap: 0.3rem;
	}
	.fact {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr) auto;
		gap: 0.3rem;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.sub {
		font-weight: 600;
		font-size: 0.9rem;
		margin-top: 0.3rem;
	}
	.save {
		background: #a31f34;
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.4rem 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.preview {
		border: 1px dashed #bbb;
		border-radius: 8px;
		max-height: 40rem;
		overflow: auto;
		zoom: 0.7;
	}
	.muted {
		color: #666;
	}
	.small {
		font-size: 0.85rem;
		font-weight: 400;
	}
</style>

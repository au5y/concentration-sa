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

<details class="landing">
	<summary><b>Front page &amp; sign-up links</b> <span class="muted small">({landing.links.length ? `${landing.links.length} sign-up link${landing.links.length > 1 ? 's' : ''} live` : 'sign-ups closed'})</span></summary>
	<div class="cols">
		<div class="form">
			<label>Title <input bind:value={draft.title} /></label>
			<label
				>Text <span class="muted small">(blank line = new paragraph; start a line with • or - for a bullet)</span>
				<textarea rows="10" bind:value={draft.body}></textarea>
			</label>
			<fieldset>
				<legend>Sign-up links <span class="muted small">(e.g. one Google Calendar booking page per seat)</span></legend>
				{#each draft.links as l, i (i)}
					<div class="link">
						<input placeholder="Button label, e.g. Book Seat A" bind:value={l.label} />
						<input placeholder="https://calendar.app.google/…" bind:value={l.url} />
						<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
						<button title="Remove" onclick={() => removeLink(i)}>✕</button>
					</div>
				{/each}
				<button onclick={addLink}>+ Add link</button>
			</fieldset>
			<label>Message when there are no links <input bind:value={draft.closed} /></label>
			<label>Contact email <input type="email" bind:value={draft.contact} /></label>
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
		gap: 0.4rem;
	}
	.link {
		display: grid;
		grid-template-columns: 10rem minmax(0, 1fr) auto auto;
		gap: 0.3rem;
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
		zoom: 0.8;
	}
	.muted {
		color: #666;
	}
	.small {
		font-size: 0.85rem;
		font-weight: 400;
	}
</style>

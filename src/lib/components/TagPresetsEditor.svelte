<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	/** Admin editor for the suggested tags offered when editing a participant. */
	let { presets, inUse }: { presets: string[]; inUse: string[] } = $props();

	// A copy, so the admin page's 3 s refresh doesn't overwrite what's being edited.
	let draft = $state<string[]>(untrack(() => [...presets]));
	let input = $state('');
	let status = $state('');
	const dirty = $derived(draft.join('\n') !== presets.join('\n'));
	const unlisted = $derived(inUse.filter((t) => !draft.some((d) => d.toLowerCase() === t.toLowerCase())));

	function add(raw: string) {
		for (const t of raw.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
			if (!draft.some((d) => d.toLowerCase() === t.toLowerCase())) draft = [...draft, t];
		}
		input = '';
	}
	const remove = (i: number) => (draft = draft.filter((_, j) => j !== i));
	const move = (i: number, d: number) => {
		const l = [...draft];
		[l[i], l[i + d]] = [l[i + d], l[i]];
		draft = l;
	};

	async function save() {
		status = 'saving…';
		const r = await fetch('/admin/tags', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tags: draft })
		});
		const out = await r.json().catch(() => ({}));
		if (r.ok) {
			draft = out.tags;
			status = `Saved ${new Date().toLocaleTimeString()}`;
			await invalidateAll();
		} else status = `Not saved: ${out.message ?? r.statusText}`;
	}
</script>

<section class="presets">
	<h2>Suggested tags</h2>
	<p class="muted small">
		Offered as one-click buttons when you edit a participant, so everyone uses the same spelling. Removing a tag
		here doesn't remove it from participants who already have it. You can still type any other tag.
	</p>
	<ul>
		{#each draft as t, i (t)}
			<li>
				<span class="chip">{t}</span>
				<button class="small" title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
				<button class="small" title="Move down" disabled={i === draft.length - 1} onclick={() => move(i, 1)}>↓</button>
				<button class="small" title="Remove" onclick={() => remove(i)}>✕</button>
			</li>
		{/each}
	</ul>
	<form class="add" onsubmit={(e) => (e.preventDefault(), add(input))}>
		<input bind:value={input} placeholder="New tag, e.g. jumping jacks" size="30" />
		<button disabled={!input.trim()}>+ Add</button>
	</form>
	{#if unlisted.length}
		<p class="small">
			<span class="muted">In use but not suggested:</span>
			{#each unlisted as t (t)}<button class="chip add-chip" title="Add to the suggestions" onclick={() => add(t)}>+ {t}</button>{/each}
		</p>
	{/if}
	<p class="save">
		<button class="primary" disabled={!dirty} onclick={save}>Save suggested tags</button>
		<button disabled={!dirty} onclick={() => ((draft = [...presets]), (status = ''))}>Undo changes</button>
		<span class="muted small">{dirty ? 'Unsaved changes' : status}</span>
	</p>
</section>

<style>
	.presets {
		margin-top: 2.5rem;
		border-top: 1px solid #ddd;
		padding-top: 0.5rem;
	}
	ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	.chip {
		display: inline-block;
		background: #e6effc;
		color: #1f4f9e;
		border: 1px solid #c3d6f5;
		border-radius: 999px;
		font-size: 0.85rem;
		padding: 0.05rem 0.6rem;
		margin-right: 0.2rem;
	}
	.add-chip {
		cursor: pointer;
		background: #fff;
		color: #555;
		border-color: #ccc;
	}
	.add,
	.save {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.small {
		font-size: 0.8rem;
	}
	.muted {
		color: #888;
	}
	.primary {
		background: #7b2cbf;
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.4rem 0.9rem;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

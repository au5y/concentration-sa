<script lang="ts">
	import type { Landing } from '$lib/landing';

	/** The public front page; also drawn as a live preview in the admin editor. */
	let { landing }: { landing: Landing } = $props();

	type Block = { list: false; text: string } | { list: true; items: string[] };
	/** Blank lines split paragraphs; lines starting with "•", "-" or "*" become a bullet list. */
	const blocks = $derived.by(() => {
		const out: Block[] = [];
		for (const chunk of landing.body.split(/\n\s*\n/)) {
			const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
			let para: string[] = [];
			let items: string[] = [];
			const flushPara = () => para.length && (out.push({ list: false, text: para.join(' ') }), (para = []));
			const flushList = () => items.length && (out.push({ list: true, items }), (items = []));
			for (const l of lines) {
				const m = l.match(/^[•\-*]\s*(.*)$/);
				if (m) {
					flushPara();
					items.push(m[1]);
				} else {
					flushList();
					para.push(l);
				}
			}
			flushPara();
			flushList();
		}
		return out;
	});
</script>

<article>
	<h1>{landing.title}</h1>
	{#each blocks as b, i (i)}
		{#if b.list}
			<ul>{#each b.items as it, j (j)}<li>{it}</li>{/each}</ul>
		{:else}
			<p>{b.text}</p>
		{/if}
	{/each}

	<section class="signup">
		<h2>Sign up</h2>
		{#if landing.links.length}
			<div class="links">
				{#each landing.links as l, i (i)}
					<a class="btn" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
				{/each}
			</div>
		{:else}
			<p>{landing.closed}</p>
		{/if}
	</section>

	{#if landing.contact}
		<p class="contact">Questions? Email <a href="mailto:{landing.contact}">{landing.contact}</a></p>
	{/if}
</article>

<style>
	article {
		max-width: 40rem;
		margin: 0 auto;
		padding: 2.5rem 1rem 3rem;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 1.1rem;
		line-height: 1.55;
		color: #111;
	}
	h1 {
		font-size: 2.4rem;
		line-height: 1.15;
		margin: 0 0 1rem;
		color: #a31f34;
	}
	h2 {
		font-size: 1.4rem;
		margin: 0 0 0.6rem;
	}
	ul {
		padding-left: 1.3rem;
	}
	.signup {
		margin: 2rem 0;
		padding: 1.2rem 1.4rem;
		border: 2px solid #a31f34;
		border-radius: 12px;
		background: #fdf5f6;
	}
	.signup p {
		margin: 0;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.btn {
		display: inline-block;
		padding: 0.65rem 1.3rem;
		border-radius: 8px;
		background: #a31f34;
		color: white;
		font-weight: 700;
		text-decoration: none;
	}
	.btn:hover {
		background: #82192a;
	}
	.contact {
		color: #444;
	}
</style>

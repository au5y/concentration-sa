<script lang="ts">
	import type { Landing } from '$lib/landing';

	/**
	 * The public front page, after the "Step Up Your Game" flier: MIT red and Barlow, a stair
	 * climber, a heartbeat line, the facts rows, a memory-card grid, and the sign-up box (date
	 * first, then the booking link). Also drawn as the live preview in the admin editor.
	 */
	let { landing }: { landing: Landing } = $props();

	type Block = { list: false; text: string } | { list: true; items: string[] };
	/** Blank lines split paragraphs; lines starting with "•", "-" or "*" become a bullet list. */
	const blocks = $derived.by(() => {
		const out: Block[] = [];
		for (const chunk of landing.intro.split(/\n\s*\n/)) {
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

	/**
	 * 4×4 face-down cards with two flipped mid-turn: a matching pair. Example picture only; not an
	 * object from the study's boards (MIT, transport) or the practice board (⭐ ❤️ ⚽ 🎈 🔔 😀).
	 */
	const PAIR = '🍓';
	const CARDS = Array.from({ length: 16 }, (_, i) => (i === 5 ? 'left' : i === 11 ? 'right' : null));
</script>

<div class="lp">
	<header class="top">
		<span class="kicker">{landing.kicker}</span>
		<span class="tag">{landing.tag}</span>
	</header>

	<div class="hero">
		<h1>{landing.title}{#if landing.titleAccent}<br /><span>{landing.titleAccent}</span>{/if}</h1>
		<svg class="stairs" viewBox="0 0 340 190" aria-hidden="true">
			<path d="M0 190V160H68V128H136V96H204V64H272V32H340V190Z" fill="#e6e7ea" />
			<path d="M0 160H68V128H136V96H204V64H272V32H340" fill="none" stroke="#1d1f20" stroke-width="4" />
			<g fill="none" stroke="#9aa0a6" stroke-width="4" stroke-linecap="round">
				<path d="M108 44H134" /><path d="M100 58H130" /><path d="M112 72H136" />
			</g>
			<g fill="none" stroke="#a31f34" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
				<path d="M184 38L170 70" /><path d="M170 70L186 80L190 96" /><path d="M170 70L158 84L142 80" />
				<path d="M180 48L196 56L204 44" /><path d="M180 48L166 56L156 66" />
			</g>
			<circle cx="189" cy="22" r="11" fill="#a31f34" />
		</svg>
	</div>

	<svg class="pulse" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
		<path
			d="M0 50H120l10 -8l10 8h18l8 10l12 -52l14 64l10 -22h20l14 -10l14 10H440l10 -8l10 8h18l8 10l12 -52l14 64l10 -22h20l14 -10l14 10H760l10 -8l10 8h18l8 10l12 -52l14 64l10 -22h20l14 -10l14 10H1000"
			fill="none"
			stroke="#a31f34"
			stroke-width="3"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>

	<div class="info">
		<div class="text">
			{#each blocks as b, i (i)}
				{#if b.list}
					<ul>{#each b.items as it, j (j)}<li>{it}</li>{/each}</ul>
				{:else}
					<p class="intro">{b.text}</p>
				{/if}
			{/each}
			{#if landing.facts.length}
				<dl>
					{#each landing.facts as f, i (i)}<dt>{f.label}</dt><dd>{f.text}</dd>{/each}
				</dl>
			{/if}
		</div>
		<div class="cards" aria-hidden="true">
			{#each CARDS as c, i (i)}
				{#if c}<div class="card flip {c}"><span class="emoji">{PAIR}</span></div>{:else}<div class="card"></div>{/if}
			{/each}
		</div>
	</div>

	<section class="book" aria-labelledby="book-h">
		<h2 id="book-h">Book a slot</h2>
		{#if landing.date}<p class="date">{landing.date}</p>{/if}
		{#if landing.links.length}
			<div class="links">
				{#each landing.links as l, i (i)}
					<a class="btn" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <span aria-hidden="true">→</span></a>
				{/each}
			</div>
			{#each landing.links as l, i (i)}
				<a class="raw" href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a>
			{/each}
			{#if landing.signupNote}<p class="note">{landing.signupNote}</p>{/if}
		{:else}
			<p class="note">{landing.closed}</p>
		{/if}
		{#if landing.contact}
			<div class="contact">
				<span>Questions or interest</span>
				<a href="mailto:{landing.contact}">{landing.contact}</a>
			</div>
		{/if}
	</section>
</div>

<style>
	.lp {
		--red: #a31f34;
		--ink: #1d1f20;
		--grey: #ececef;
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1.5rem 2.5rem;
		box-sizing: border-box;
		font-family: 'Barlow', system-ui, sans-serif;
		color: var(--ink);
		background: #fff;
		overflow: hidden;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		font-weight: 700;
		font-size: 0.85rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.kicker {
		color: var(--red);
	}
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1.5rem;
		margin-top: 0.8rem;
	}
	h1 {
		margin: 0;
		font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		font-weight: 800;
		font-size: clamp(3.2rem, 11vw, 6.5rem);
		line-height: 0.86;
		letter-spacing: -0.01em;
		text-transform: uppercase;
	}
	h1 span {
		color: var(--red);
	}
	.stairs {
		width: min(34%, 20rem);
		height: auto;
		flex: none;
		display: block;
	}
	.pulse {
		display: block;
		width: calc(100% + 3rem);
		margin: 0.8rem -1.5rem 0;
		height: 2.6rem;
	}
	.info {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: 2.5rem;
		align-items: start;
		margin-top: 0.8rem;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.intro,
	ul {
		margin: 0;
		font-size: 1.2rem;
		line-height: 1.4;
		font-weight: 500;
		text-wrap: pretty;
	}
	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 1.2rem;
		row-gap: 0.5rem;
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.3;
	}
	dt {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--red);
	}
	dd {
		margin: 0;
		text-wrap: pretty;
	}
	dd:first-of-type {
		font-weight: 600;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.6rem;
		margin-top: 0.3rem;
	}
	.card {
		aspect-ratio: 1;
		border-radius: 0.5rem;
		background: #1f63d6;
		box-shadow:
			inset 0 0 0 0.35rem #1f63d6,
			inset 0 0 0 0.55rem #8fb1eb;
	}
	.card.flip {
		background: var(--grey);
		border: 0.2rem solid var(--ink);
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		line-height: 1;
		box-shadow: 0.3rem 0.45rem 0 #c9ccd1;
		transform: perspective(20rem) rotateY(38deg) rotate(-10deg) scale(1.08);
	}
	.card .emoji {
		font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
	}
	.card.right {
		box-shadow: -0.3rem 0.45rem 0 #c9ccd1;
		transform: perspective(20rem) rotateY(-34deg) rotate(9deg) scale(1.08);
	}
	.book {
		margin-top: 2.2rem;
		background: var(--grey);
		border-radius: 1rem;
		padding: 1.6rem 2rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.8rem;
	}
	h2 {
		margin: 0;
		font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		font-weight: 800;
		font-size: clamp(2.2rem, 6vw, 3rem);
		line-height: 0.95;
		text-transform: uppercase;
	}
	.date {
		margin: 0;
		font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		font-weight: 700;
		font-size: clamp(1.5rem, 4.5vw, 2rem);
		line-height: 1.1;
		color: var(--red);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin-top: 0.2rem;
	}
	.btn {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		border-radius: 0.6rem;
		background: var(--red);
		color: #fff;
		font-weight: 700;
		font-size: 1.15rem;
		text-decoration: none;
	}
	.btn:hover {
		background: #82192a;
	}
	.raw {
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.raw:hover {
		color: var(--red);
		text-decoration: underline;
	}
	.note {
		margin: 0;
		font-size: 1.1rem;
		line-height: 1.35;
		font-weight: 500;
		text-wrap: pretty;
	}
	.contact {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 0.4rem;
	}
	.contact span {
		font-weight: 700;
		font-size: 0.8rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #4a4f55;
	}
	.contact a {
		font-weight: 700;
		font-size: 1.2rem;
		color: var(--red);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.contact a:hover {
		text-decoration: underline;
	}
	@media (max-width: 640px) {
		.lp {
			padding: 1.25rem 1rem 2rem;
		}
		.pulse {
			width: calc(100% + 2rem);
			margin: 0.6rem -1rem 0;
		}
		.info {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}
		.cards {
			width: min(100%, 14rem);
			justify-self: center;
		}
		.book {
			padding: 1.25rem;
		}
	}
</style>

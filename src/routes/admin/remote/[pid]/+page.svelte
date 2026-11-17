<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { remotePath } from '$lib/remote';

	/**
	 * Facilitator console for one participant, usually a remote one (RP) on a call: watch their
	 * phase, progress and heart rate, and do what the Ctrl+Shift+F shortcut does on a study
	 * laptop (start the baseline / timers, record RPE, move on). Refreshes every 1.5 s.
	 */
	let { data } = $props();
	const s = $derived(data.s);
	let notice = $state('');
	let busy = $state(false);
	let tick = $state(Date.now());
	let copied = $state(false);

	onMount(() => {
		const r = setInterval(() => invalidateAll(), 1500);
		const t = setInterval(() => (tick = Date.now()), 250);
		return () => (clearInterval(r), clearInterval(t));
	});

	const link = $derived(data.key && typeof location !== 'undefined' ? location.origin + remotePath(data.pid, data.key) : '');
	async function copyLink() {
		await navigator.clipboard.writeText(link);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	async function act(payload: Record<string, unknown>, confirmMsg?: string) {
		if (!s || busy) return;
		if (confirmMsg && !confirm(confirmMsg)) return;
		busy = true;
		try {
			const r = await fetch(`/admin/remote/${encodeURIComponent(data.pid)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ phase: s.phase, ...payload })
			});
			notice = r.ok ? '' : `Failed: ${(await r.json().catch(() => ({}))).message ?? r.statusText}`;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	// Server clock (approximately) for countdowns.
	const offset = $derived(s ? s.now - Date.now() : 0);
	const serverNow = $derived(tick + offset);
	const marker = (name: string) => s?.markers.find((m) => m.name === name) ?? null;
	const fmt = (ms: number) => {
		const t = Math.max(0, Math.ceil(ms / 1000));
		return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
	};
	const ago = (ms: number) => {
		const t = Math.max(0, Math.round(ms / 1000));
		return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${t % 60}s`;
	};

	const NEXT: Record<string, string> = {
		baseline: 'Begin practice',
		practice: 'End practice → exercise/rest',
		interval1: 'Continue to Game A',
		interval2: 'Continue to Game B',
		break: 'Start the questions'
	};

	// Heart rate
	const last = $derived(s?.hr.at(-1) ?? null);
	const hrAge = $derived(last ? serverNow - last.ts : null);
	function spark(h: { ts: number; bpm: number }[]): string {
		if (h.length < 2 || !s) return '';
		const lo = Math.min(...h.map((x) => x.bpm)) - 3;
		const hi = Math.max(...h.map((x) => x.bpm)) + 3;
		const t0 = s.now - 5 * 60_000;
		return h.map((x) => `${(((x.ts - t0) / (5 * 60_000)) * 100).toFixed(1)},${(40 - ((x.bpm - lo) / (hi - lo)) * 40).toFixed(1)}`).join(' ');
	}

	// RPE form (exercise/rest bouts)
	const BORG: Record<number, string> = { 6: 'No exertion', 7: 'Extremely light', 9: 'Very light', 11: 'Light', 13: 'Somewhat hard', 15: 'Hard', 17: 'Very hard', 19: 'Extremely hard', 20: 'Maximal' };
	let rpe = $state<number | null>(null);
	let peak = $state<number | null>(null);
	let formFor = '';
	$effect(() => {
		// Reset the form when the phase changes; fill it from what is saved.
		const k = s ? `${s.phase}:${s.phaseStartedAt}` : '';
		if (k !== formFor) {
			formFor = k;
			rpe = s?.bout?.rpe ?? null;
			peak = s?.bout?.peak_hr ?? null;
		}
	});
	const saveBout = () => rpe !== null && act({ action: 'bout', rpe, peak_hr: peak ?? s?.peak ?? null });

	function advanceBout() {
		if (!s) return;
		const ms = s.timers.interval_ms[s.phase as 'interval1'];
		const st = marker('start');
		const running = ms > 0 && (!st || serverNow < st.at + ms);
		const noRpe = s.recordRpe && !s.bout;
		const warn = [running && 'the timer is still running', noRpe && 'no RPE has been recorded'].filter(Boolean).join(' and ');
		act({ action: 'advance' }, warn ? `Continue although ${warn}?` : undefined);
	}
</script>

<svelte:head><title>{data.pid} console · Step Up Your Game (HSE Study)</title></svelte:head>

<main>
	<p class="back"><a href="/admin">← Admin</a></p>
	<header>
		<h1>{data.pid}{#if s?.remote || data.key} <span class="rp">RP</span>{/if}</h1>
		{#if link}
			<div class="link">
				<code>{link}</code>
				<button onclick={copyLink}>{copied ? 'Copied ✓' : 'Copy participant link'}</button>
			</div>
		{/if}
	</header>
	{#if notice}<p class="err">{notice}</p>{/if}

	{#if !s}
		<p class="big">Waiting for {data.pid} to open their link…</p>
		<p class="muted">
			{#if data.key}Send them the link above (Zoom chat, email). They need Chrome or Edge on a laptop/desktop (or Chrome on Android) to connect their heart-rate strap; iPhones and iPads can't.
			{:else}{data.pid} is not a remote participant. Mark them remote on the admin page, or open <a href="/run?pid={data.pid}">/run?pid={data.pid}</a> on a study laptop.{/if}
		</p>
	{:else}
		<p class="meta">
			{s.condition} · A={s.board_a_theme} B={s.board_b_theme}
			{#if s.tags}· tags: {s.tags}{/if}
			· last activity {ago(serverNow - s.updatedAt)} ago
		</p>

		<ol class="phases">
			{#each s.phases as p (p)}
				<li class:cur={p === s.phase} class:past={s.phases.indexOf(p) < s.phases.indexOf(s.phase)}>{p}</li>
			{/each}
		</ol>

		<div class="grid">
			<section class="card now">
				<h2>{s.phase} <small>· {ago(serverNow - s.phaseStartedAt)} in phase</small></h2>

				{#if s.phase === 'survey'}
					<p>They are answering the survey on their screen (age, exercise days, fitness, sleep). Read the questions out if they need help.</p>
				{:else if s.phase === 'baseline'}
					{@const st = marker('start')}
					{#if !st}
						<p>Ask them to put on the strap (wet the electrodes) and click <b>Connect heart-rate strap</b> on their screen. When the heart rate shows here and they are sitting still, start the baseline.</p>
						<button class="go" disabled={busy} onclick={() => act({ action: 'start' })}>Start baseline</button>
					{:else}
						<p class="ok">Baseline started {ago(serverNow - st.at)} ago.</p>
						<button class="go" disabled={busy} onclick={() => act({ action: 'advance' })}>{NEXT.baseline} →</button>
					{/if}
				{:else if s.phase === 'practice'}
					<p>They are playing the practice board. When they say they're done (or to cut it short):</p>
					<button class="go" disabled={busy} onclick={() => act({ action: 'advance' }, 'End practice and move on to the exercise/rest period?')}>{NEXT.practice} →</button>
				{:else if s.phase === 'interval1' || s.phase === 'interval2'}
					{@const ms = s.timers.interval_ms[s.phase]}
					{@const st = marker('start')}
					{#if ms > 0 && !st}
						<p>Timer not started ({fmt(ms)}). They can press Start on their screen, or:</p>
						<button class="go" disabled={busy} onclick={() => act({ action: 'start' })}>Start timer</button>
					{:else if ms > 0 && st && serverNow < st.at + ms}
						<p class="clock">{fmt(st.at + ms - serverNow)}</p>
					{:else}
						<p class="ok">{ms > 0 ? "Time's up." : 'No timer for this period.'}</p>
					{/if}
					{#if s.recordRpe}
						<div class="rpe">
							<p><b>RPE:</b> ask "How hard did that feel, from 6 to 20?" {#if s.bout}<span class="ok">saved: {s.bout.rpe}{s.bout.peak_hr ? ` · peak ${s.bout.peak_hr}` : ''} ✓</span>{/if}</p>
							<div class="borg">
								{#each Array.from({ length: 15 }, (_, i) => i + 6) as n (n)}
									<button class:sel={rpe === n} onclick={() => ((rpe = n), saveBout())}><b>{n}</b><span>{BORG[n] ?? ''}</span></button>
								{/each}
							</div>
							<label>Peak HR
								<input type="number" min="30" max="250" placeholder={s.peak ? String(s.peak) : 'bpm'} value={peak ?? ''}
									oninput={(e) => { const v = e.currentTarget.valueAsNumber; peak = Number.isFinite(v) ? Math.round(v) : null; }}
									onchange={saveBout} />
							</label>
							{#if s.peak}<span class="muted small">strap peak this bout: {s.peak} bpm (used if left blank)</span>{/if}
						</div>
					{:else}
						<p class="muted">No RPE for the {s.condition} condition.</p>
					{/if}
					<button class="go" disabled={busy} onclick={advanceBout}>{NEXT[s.phase]} →</button>
				{:else if s.phase === 'board_a' || s.phase === 'board_b'}
					{@const play = marker('play')}
					{#if s.boardProgress}
						<p class="big">{s.boardProgress.pairs} / {s.boardProgress.total} pairs · {s.boardProgress.clicks} clicks</p>
					{/if}
					{#if !play}<p>Cards are face up (preview).</p>
					{:else if s.timers.time_limit_ms > 0}<p>{fmt(play.at + s.timers.time_limit_ms - serverNow)} left</p>{/if}
					<p class="muted">The game moves on by itself when the board is cleared or time runs out.</p>
				{:else if s.phase === 'break'}
					<p>Short break. When they're ready:</p>
					<button class="go" disabled={busy} onclick={() => act({ action: 'advance' })}>{NEXT.break} →</button>
				{:else if s.phase === 'sa'}
					<p class="big">{s.sa.answered} / {s.sa.total} answered</p>
					{#if !s.remote}<p class="muted">In-person session: the environment questions are asked at the study laptop (Ctrl+Shift+F).</p>{/if}
				{:else}
					<p class="ok big">Complete ✓</p>
				{/if}
			</section>

			<section class="card hr">
				<h2>Heart rate</h2>
				{#if last}
					<p class="bpm" class:stale={(hrAge ?? 0) > 6}>{last.bpm}<small> bpm</small></p>
					<p class="muted small">
						{(hrAge ?? 0) > 6 ? `no reading for ${ago(hrAge ?? 0)}` : 'live'}
						{#if last.contact === 0}· <span class="err">no skin contact</span>{/if}
					</p>
					<svg viewBox="0 0 100 40" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline points={spark(s.hr)} /></svg>
					<p class="muted small">last 5 minutes</p>
				{:else}
					<p class="muted">No heart-rate readings in the last 5 minutes.</p>
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		background: #fff;
		color: #111;
	}
	main {
		max-width: 64rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.back {
		margin: 0;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
	}
	h1 {
		margin: 0.4rem 0;
	}
	.rp {
		background: #0b7a75;
		color: white;
		font-size: 0.9rem;
		padding: 0.1rem 0.5rem;
		border-radius: 4px;
		vertical-align: middle;
	}
	.link {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
	}
	.link code {
		font-size: 0.8rem;
		background: #f2f4f7;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	.meta {
		color: #555;
	}
	.phases {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		list-style: none;
		padding: 0;
	}
	.phases li {
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #ccc;
		font-size: 0.85rem;
		color: #666;
	}
	.phases li.past {
		background: #eef6ee;
		border-color: #b9dcbf;
	}
	.phases li.cur {
		background: #1f63d6;
		border-color: #1f63d6;
		color: white;
		font-weight: 700;
	}
	.grid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1rem;
	}
	@media (max-width: 700px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.card {
		border: 2px solid #d5dbe6;
		border-radius: 12px;
		padding: 1rem 1.2rem;
	}
	.card h2 {
		margin-top: 0;
	}
	.card h2 small {
		font-weight: 400;
		color: #777;
		font-size: 0.9rem;
	}
	.go {
		font-size: 1.15rem;
		font-weight: 700;
		padding: 0.6rem 1.4rem;
		border-radius: 8px;
		border: none;
		background: #2a9d3f;
		color: white;
		cursor: pointer;
		margin-top: 0.6rem;
	}
	.go:disabled {
		opacity: 0.6;
	}
	.clock {
		font-size: 3.5rem;
		font-weight: 800;
		color: #1f63d6;
		margin: 0.3rem 0;
		font-variant-numeric: tabular-nums;
	}
	.big {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.ok {
		color: #2a9d3f;
		font-weight: 600;
	}
	.rpe {
		margin: 0.8rem 0;
		padding: 0.6rem 0.8rem;
		background: #fff8dc;
		border-radius: 8px;
	}
	.borg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.6rem;
	}
	.borg button {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 3.2rem;
		padding: 0.2rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	.borg button span {
		font-size: 0.6rem;
		color: #666;
	}
	.borg button.sel {
		background: #1f63d6;
		border-color: #1f63d6;
		color: white;
	}
	.borg button.sel span {
		color: #dde;
	}
	.rpe input {
		width: 5rem;
	}
	.bpm {
		font-size: 3.5rem;
		font-weight: 800;
		color: #c0392b;
		margin: 0;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.bpm.stale {
		color: #b07d00;
	}
	.bpm small {
		font-size: 1rem;
		color: #777;
	}
	.spark {
		width: 100%;
		height: 4rem;
	}
	.spark polyline {
		fill: none;
		stroke: #c0392b;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.muted {
		color: #777;
	}
	.small {
		font-size: 0.85rem;
	}
	.err {
		color: #b00;
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import ObjectImage from '$lib/components/ObjectImage.svelte';
	import { remotePath } from '$lib/remote';
	import { renderSpec } from '$lib/render';

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

	async function endSession() {
		if (!s) return;
		const reason = prompt(
			`End ${data.pid}'s session now? Their screen will say the session has ended and nothing more is recorded. ` +
				`The data so far is kept and tagged "aborted" (delete or archive it on the admin page).\n\nReason (e.g. left during Game A):`,
			'participant left'
		);
		if (reason === null) return;
		await act({ action: 'abort', reason });
	}

	// Admin override: move the session to any phase (clears data from that phase on).
	let jumpTo = $state('');
	function jump(to: string, label: string) {
		if (!s) return;
		const idx = s.phases.indexOf(to as (typeof s.phases)[number]);
		const clears = s.phases.slice(idx).filter((p) => ['survey', 'interval1', 'board_a', 'interval2', 'board_b', 'sa'].includes(p));
		const msg =
			`${label}: move ${data.pid} to "${to}"?` +
			(clears.length ? `\n\nThis deletes what was recorded in ${clears.join(', ')} (heart rate is kept).` : '') +
			(s.abortedAt ? '\n\nThe session was ended; this reopens it.' : '');
		act({ action: 'jump', to }, msg);
	}
	const nextPhase = $derived(s ? s.phases[s.phases.indexOf(s.phase) + 1] : undefined);

	// Survey filled in for them
	let sv = $state({ age: null as number | null, exercise_days: null as number | null, fitness: null as number | null, hours_slept: null as number | null });
	const svValid = $derived(
		sv.age !== null && sv.age >= 16 && sv.age <= 99 && sv.exercise_days !== null && sv.exercise_days >= 0 && sv.exercise_days <= 7 &&
			sv.fitness !== null && sv.fitness >= 1 && sv.fitness <= 5 && sv.hours_slept !== null && sv.hours_slept >= 0 && sv.hours_slept <= 24
	);
	const FITNESS = ['', 'Very low', 'Low', 'Moderate', 'High', 'Very high'];

	// Live board (read only): what is face up on their screen, from the recorded flips.
	const board = $derived.by(() => {
		if (!s?.live || !s.manifest) return null;
		const items = new Map(s.manifest.objects.map((o) => [o.id, o]));
		const matched = new Set<number>();
		let pending: number | null = null;
		let lastMiss: [number, number] | null = null;
		for (const c of s.live.clicks) {
			if (c.outcome === 'first_flip') {
				pending = c.card_index;
				lastMiss = null;
			} else {
				if (c.outcome === 'match') {
					matched.add(c.card_index);
					if (pending !== null) matched.add(pending);
					lastMiss = null;
				} else if (pending !== null) lastMiss = [pending, c.card_index];
				pending = null;
			}
		}
		const last = s.live.clicks.at(-1);
		return {
			cols: s.live.cols,
			cells: s.live.cards.map((id, i) => {
				const item = items.get(id);
				return {
					label: item?.label ?? id,
					spec: item ? renderSpec(s.live!.theme, item, s.colors, s.orientations) : null,
					state: matched.has(i) ? 'matched' : pending === i ? 'up' : lastMiss?.includes(i) ? 'miss' : 'down'
				};
			}),
			lastAt: last ? last.client_ts : null
		};
	});
	let peek = $state(false);
	const label = (t: string) => ({ objects: 'recognition grid', side_by_side: 'side by side', level2_color: 'same color as', level2_count: 'how many', oral: 'environment' })[t] ?? t;

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

		{#if s.abortedAt}
			<p class="ended">Ended early {new Date(s.abortedAt).toLocaleTimeString()} during <b>{s.phase}</b>{s.abortReason ? `: ${s.abortReason}` : ''}. Nothing more is recorded. Delete or archive it on the <a href="/admin">admin page</a>.</p>
		{/if}

		<ol class="phases">
			{#each s.phases as p (p)}
				<li class:cur={p === s.phase} class:past={s.phases.indexOf(p) < s.phases.indexOf(s.phase)}>{p}</li>
			{/each}
		</ol>

		<div class="grid">
			<section class="card now">
				<h2>{s.phase} <small>· {s.abortedAt ? 'ended' : `${ago(serverNow - s.phaseStartedAt)} in phase`}</small></h2>

				{#if s.abortedAt}
					<p class="muted">Session ended.</p>
				{:else if s.phase === 'survey'}
					<p>They are answering the survey on their screen. Or ask them and fill it in here (this moves them on to the baseline):</p>
					<form class="svform" onsubmit={(e) => (e.preventDefault(), svValid && act({ action: 'survey', answers: sv }))}>
						<label>Age <input type="number" min="16" max="99" bind:value={sv.age} /></label>
						<label>Exercise days / week <input type="number" min="0" max="7" bind:value={sv.exercise_days} /></label>
						<label>Fitness
							<select bind:value={sv.fitness}>
								<option value={null}>—</option>
								{#each [1, 2, 3, 4, 5] as n (n)}<option value={n}>{n} · {FITNESS[n]}</option>{/each}
							</select>
						</label>
						<label>Hours slept <input type="number" min="0" max="24" step="0.5" bind:value={sv.hours_slept} /></label>
						<button class="go" disabled={busy || !svValid}>Save survey &amp; continue →</button>
					</form>
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
					{#if board}
						<div class="live" style:--cols={board.cols}>
							{#each board.cells as c, i (i)}
								<div class="lc {c.state}" class:peek={peek && c.state === 'down'} title={c.label}>
									{#if c.spec && (c.state !== 'down' || peek || !play)}<ObjectImage spec={c.spec} size="62%" />{/if}
								</div>
							{/each}
						</div>
						<p class="muted small">
							Read only, from their recorded flips: <span class="k up">face up</span> <span class="k matched">matched</span> <span class="k miss">last mismatch</span>
							<label class="peekl"><input type="checkbox" bind:checked={peek} /> show hidden cards</label>
						</p>
					{/if}
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
		<section class="card data">
			<h2>Their answers</h2>
			<div class="cols">
				<div>
					<h3>Survey</h3>
					{#if s.survey}
						<p>Age {s.survey.age} · exercise {s.survey.exercise_days} d/wk · fitness {s.survey.fitness} ({FITNESS[s.survey.fitness]}) · slept {s.survey.hours_slept} h</p>
					{:else}<p class="muted">Not filled in yet.</p>{/if}
					<h3>Exercise / rest</h3>
					{#if s.bouts.length}
						{#each s.bouts as b (b.bout)}<p>{b.bout === 'interval1' ? 'Bout 1' : 'Bout 2'}: RPE {b.rpe}{b.peak_hr ? ` · peak HR ${b.peak_hr}` : ''}</p>{/each}
					{:else}<p class="muted">No RPE yet.</p>{/if}
				</div>
				<div>
					<h3>Questions ({s.sa.answered}/{s.sa.total})</h3>
					{#if s.answers.length}
						{@const single = s.answers.filter((a) => a.question_type !== 'objects')}
						{@const grid = s.answers.filter((a) => a.question_type === 'objects')}
						{#each [...new Set(grid.map((g) => g.board))] as bd (bd)}
							{@const g = grid.filter((x) => x.board === bd)}
							<p>Board {bd} recognition grid: {g.filter((x) => x.target === 'seen' && x.response === 'selected').length}/{g.filter((x) => x.target === 'seen').length} seen picked, {g.filter((x) => x.target === 'foil' && x.response === 'selected').length} foils picked</p>
						{/each}
						<table>
							<tbody>
								{#each single as a (a.seq + a.item)}
									<tr class:wrong={!a.correct}>
										<td>{a.seq + 1}</td><td>{a.board}</td><td>{label(a.question_type)}</td><td>{a.item}</td>
										<td>{a.response === 'dont_remember' ? "don't remember" : a.response}</td><td>{a.correct ? '✓' : '✗'}</td>
										<td class="muted">{a.confidence ? `conf ${a.confidence}` : ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}<p class="muted">None yet.</p>{/if}
				</div>
			</div>
		</section>

		<section class="card god">
			<h2>Override</h2>
			<p class="row">
				{#if s.abortedAt}
					<button disabled={busy} onclick={() => jump(s.phase, 'Resume')}>Resume: restart {s.phase}</button>
				{:else}
					<button disabled={busy} onclick={() => jump(s.phase, 'Restart phase')}>Restart this phase</button>
					{#if nextPhase}<button disabled={busy} onclick={() => jump(nextPhase, 'Skip')}>Skip to {nextPhase}</button>{/if}
				{/if}
				<button disabled={busy} onclick={() => jump('survey', 'Restart from the beginning')}>Restart from the beginning</button>
				<label>Go to
					<select bind:value={jumpTo}>
						<option value="">phase…</option>
						{#each s.phases as p (p)}<option value={p}>{p}</option>{/each}
					</select>
				</label>
				<button disabled={busy || !jumpTo} onclick={() => jump(jumpTo, 'Go to phase')}>Go</button>
			</p>
			<p class="muted small">Moving to a phase deletes what was recorded in it and in later ones, so it starts fresh. Every move is logged in the change history. Their screen follows within 2 s.</p>
			{#if !s.abortedAt && s.phase !== 'done'}
				<p class="row"><button class="end" disabled={busy} onclick={endSession}>End session early…</button>
					<span class="muted small">Participant left or the data is unusable.</span></p>
			{/if}
		</section>
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
	.ended {
		background: #fdecea;
		border: 1px solid #f5c2bc;
		color: #8a1c10;
		padding: 0.6rem 1rem;
		border-radius: 8px;
	}
	.data,
	.god {
		margin-top: 1rem;
	}
	.data h3 {
		font-size: 1rem;
		margin: 0.8rem 0 0.3rem;
	}
	.data .cols {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: 1.5rem;
	}
	@media (max-width: 700px) {
		.data .cols {
			grid-template-columns: 1fr;
		}
	}
	.data p {
		margin: 0.2rem 0;
	}
	.data table {
		border-collapse: collapse;
		font-size: 0.85rem;
		width: 100%;
	}
	.data td {
		border-bottom: 1px solid #eee;
		padding: 0.2rem 0.4rem;
	}
	.data tr.wrong td {
		color: #a33;
	}
	.god .row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	.svform {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.5rem 1rem;
		align-items: end;
	}
	.svform label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		gap: 0.2rem;
	}
	.svform input,
	.svform select {
		font-size: 1rem;
		padding: 0.25rem;
	}
	.live {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 0.35rem;
		max-width: 24rem;
		margin: 0.6rem 0;
	}
	.lc {
		aspect-ratio: 1;
		border-radius: 8px;
		border: 2px solid #c8d0de;
		background: #3d5a99;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.lc.up,
	.lc.matched,
	.lc.miss,
	.lc.peek {
		background: #fff;
	}
	.lc.up {
		border-color: #1f63d6;
		box-shadow: 0 0 0 2px #1f63d6;
	}
	.lc.matched {
		border-color: #2a9d3f;
		background: #eef8f0;
	}
	.lc.miss {
		border-color: #e0a800;
	}
	.lc.peek {
		opacity: 0.45;
		border-style: dashed;
	}
	.k {
		padding: 0 0.3rem;
		border-radius: 3px;
		border: 2px solid;
	}
	.k.up {
		border-color: #1f63d6;
	}
	.k.matched {
		border-color: #2a9d3f;
	}
	.k.miss {
		border-color: #e0a800;
	}
	.peekl {
		margin-left: 0.8rem;
	}
	.end {
		color: #b00;
		border: 1px solid #b00;
		background: white;
		border-radius: 6px;
		padding: 0.35rem 0.9rem;
		cursor: pointer;
	}
	.small {
		font-size: 0.85rem;
	}
	.err {
		color: #b00;
	}
</style>

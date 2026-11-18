<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, nowTs } from '$lib/client/api';
	import Board from '$lib/components/Board.svelte';
	import OwnHeartRate from '$lib/components/OwnHeartRate.svelte';
	import { StrapManager } from '$lib/client/hr-straps.svelte';
	import Interval from '$lib/components/Interval.svelte';
	import { primeAudio } from '$lib/client/metronome';
	import Sa from '$lib/components/Sa.svelte';
	import Survey from '$lib/components/Survey.svelte';
	import type { SessionState } from '$lib/state';
	import { PHASES, type ClickRecord } from '$lib/types';

	let { data } = $props();
	const pid = page.url.searchParams.get('pid');
	let runPassword = $state('');
	let runError = $state('');

	async function runLogin(e: SubmitEvent) {
		e.preventDefault();
		const r = await fetch('/run/auth', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password: runPassword })
		});
		if (r.ok) location.reload();
		else runError = 'Wrong password';
	}

	let s = $state<SessionState | null>(null);
	let loadError = $state('');
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let practiceDone = $state(false);
	let confirmUntil = 0;
	let busy = false;
	/** Server clock minus this computer's clock, for resuming board timers after a reload. */
	let clockOffset = $state(0);

	// Start-page form
	let formPid = $state('');
	let newRemote = $state(false);
	let newBusy = $state(false);
	let created = $state<{ pid: string; link: string } | null>(null);
	let copied = $state(false);

	/** A remote participant's own strap (their computer). Lives as long as the page, across phases. */
	let ownHr = $state<StrapManager | null>(null);
	/** Only a logged-in study laptop gets the facilitator shortcut; a remote participant's browser doesn't. */
	const laptop = $derived(!!data.laptop && !s?.remote);

	function say(msg: string, ms = 3000) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), ms);
	}

	function setState(next: SessionState) {
		if (s?.phase !== next.phase) practiceDone = false;
		clockOffset = next.serverNow - Date.now();
		s = next;
	}

	onMount(() => {
		// Unlock sound on the participant's first click / key press, so the step-test metronome
		// can play later even when the timer is started from the facilitator console.
		primeAudio();
		if (!pid || !data.authed) return;
		// The participant cannot navigate back.
		history.pushState(null, '', location.href);
		const onPop = () => history.pushState(null, '', location.href);
		window.addEventListener('popstate', onPop);
		let poll: ReturnType<typeof setInterval> | undefined;
		api.session(pid).then((st) => {
			setState(st);
			if (st.aborted) return;
			// Follow the facilitator's console: remote sessions are moved on from there, and any
			// session can be ended, restarted or moved to another phase there.
			poll = setInterval(followFacilitator, 2000);
			if (!st.remote) return;
			ownHr = new StrapManager({ pid: st.pid });
			ownHr.start();
		}, (e) => (loadError = e.message));
		return () => {
			window.removeEventListener('popstate', onPop);
			clearInterval(poll);
			ownHr?.stop();
		};
	});

	/** Remote sessions: pick up phase changes, timer starts and RPE made on the facilitator's console. */
	async function followFacilitator() {
		if (!s || busy) return;
		try {
			const next = await api.poll(s.pid);
			if (!s || busy) return;
			if (next.aborted) {
				s = next;
				ownHr?.stop();
				return;
			}
			if (next.phase !== s.phase || next.phaseStartedAt !== s.phaseStartedAt) setState(next);
			else {
				clockOffset = next.serverNow - Date.now();
				const have = new Set(s.progress.markers.map((m) => `${m.name}@${m.at}`));
				if (next.progress.markers.some((m) => !have.has(`${m.name}@${m.at}`))) s.progress.markers = next.progress.markers;
				if (JSON.stringify(next.progress.bout) !== JSON.stringify(s.progress.bout)) s.progress.bout = next.progress.bout;
				// Condition switched on the admin page / console: new instructions and RPE form, same board order.
				if (next.condition !== s.condition) {
					s.condition = next.condition;
					s.text = next.text;
					s.recordRpe = next.recordRpe;
					s.metronomeBpm = next.metronomeBpm;
				}
			}
		} catch {
			// offline for a moment: try again next tick
		}
	}

	async function newParticipant() {
		newBusy = true;
		try {
			const r = await fetch('/api/session/new', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ remote: newRemote })
			});
			const out = await r.json().catch(() => ({}));
			if (!r.ok) return say(`Could not create: ${out.message ?? r.statusText}`, 6000);
			if (!newRemote) location.href = `/run?pid=${encodeURIComponent(out.pid)}`;
			else created = { pid: out.pid, link: `${location.origin}/run?pid=${encodeURIComponent(out.pid)}&key=${encodeURIComponent(out.key)}` };
		} finally {
			newBusy = false;
		}
	}

	const marker = (name: string) => s?.progress.markers.find((m) => m.name === name) ?? null;
	/** Play time already used on the current board (server clock), for resuming after a reload. */
	const playElapsed = () => {
		const play = marker('play');
		return play ? Math.max(0, Date.now() + clockOffset - play.at) : 0;
	};

	/** Log the timeout and move on. Retries for a few seconds in case the server's clock check is still a moment behind. */
	async function boardTimeout() {
		const phase = s?.phase;
		for (let i = 0; i < 5 && s?.phase === phase; i++) {
			if (i) await new Promise((r) => setTimeout(r, 2000));
			await addMarker('timeout');
			await advance();
		}
	}

	async function addMarker(name: string, ts = nowTs()) {
		if (!s) return;
		const phase = s.phase;
		try {
			const { at } = await api.mark(s.pid, phase, name, ts);
			if (s.phase === phase) s.progress.markers = [...s.progress.markers, { name, at }];
		} catch (e) {
			say(`Could not record ${name}: ${(e as Error).message}`, 6000);
		}
	}

	async function advance(facilitator = false) {
		if (!s || busy) return;
		busy = true;
		try {
			setState(await api.advance(s.pid, s.phase, facilitator));
		} catch (e) {
			say(`Could not continue: ${(e as Error).message}`, 6000);
		} finally {
			busy = false;
		}
	}

	/** Advance now if `ready`, otherwise require a second press within 3 s. */
	function confirmThen(ready: boolean, what: string) {
		if (ready || performance.now() < confirmUntil) {
			confirmUntil = 0;
			advance(true);
		} else {
			confirmUntil = performance.now() + 3000;
			say(`Facilitator: press again to ${what}`);
		}
	}

	function facilitatorKey() {
		if (!s) return;
		switch (s.phase) {
			case 'baseline':
				if (!marker('start')) addMarker('start');
				else advance(true);
				break;
			case 'interval1':
			case 'interval2': {
				const ms = s.timers.interval_ms[s.phase];
				const start = marker('start');
				if (ms > 0 && !start) {
					addMarker('start');
					break;
				}
				const running = !!start && Date.now() + clockOffset < start.at + ms;
				const noRpe = s.recordRpe && !s.progress.bout;
				const what = running ? (noRpe ? 'skip the timer and continue without RPE' : 'skip the rest of the timer') : 'continue without recording RPE';
				confirmThen(!running && !noRpe, what);
				break;
			}
			case 'break':
				advance(true);
				break;
			case 'practice':
				confirmThen(practiceDone, 'skip the rest of practice');
				break;
			case 'done':
				location.href = '/run';
				break;
			case 'sa':
				break; // Sa.svelte unlocks the environment questions itself
			default:
				say('The participant controls this phase.');
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.ctrlKey && e.shiftKey && e.code === 'KeyF' && laptop) {
			e.preventDefault();
			facilitatorKey();
		}
	}

	// Developer toolbar (test sessions only)
	let devOpen = $state(false);
	async function jump(phase: string, fast?: boolean) {
		if (!s) return;
		try {
			setState(await api.jump(s.pid, phase, fast));
			devOpen = false;
		} catch (e) {
			say(`Jump failed: ${(e as Error).message}${(e as { status?: number }).status === 401 ? ' (log in at /admin in this browser)' : ''}`, 6000);
		}
	}

	function onFlip(board: 'A' | 'B', c: ClickRecord) {
		if (!s) return;
		api.click(s.pid, { board, ...c }).catch((e) => say(`Click not saved: ${e.message}`, 6000));
	}

	function startSession(e: SubmitEvent) {
		e.preventDefault();
		const p = formPid.trim().toUpperCase();
		if (p) location.href = `/run?pid=${encodeURIComponent(p)}`;
	}
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Step Up Your Game (HSE Study)</title></svelte:head>

{#if !data.authed && !data.laptop && (data.badLink || pid)}
	<main class="start">
		<h1>This link doesn't work</h1>
		<p>Please ask your facilitator to send you your participant link again.</p>
		<details class="small"><summary>Study laptop?</summary>
			<form onsubmit={runLogin}>
				<label>Study password <input type="password" bind:value={runPassword} autocomplete="current-password" required /></label>
				<button type="submit">Log in</button>
			</form>
			{#if runError}<p class="small">{runError}</p>{/if}
		</details>
	</main>
{:else if !data.authed}
	<main class="start">
		<h1>Study laptop login</h1>
		<form onsubmit={runLogin}>
			<label>Study password <input type="password" bind:value={runPassword} autocomplete="current-password" required /></label>
			<button type="submit">Log in</button>
		</form>
		{#if runError}<p class="small">{runError}</p>{/if}
		<p class="small">This laptop stays logged in for a week.</p>
	</main>
{:else if !pid}
	<main class="start">
		<h1>Concentration study</h1>
		<form onsubmit={startSession}>
			<label>Participant ID <input bind:value={formPid} placeholder="P07" autocomplete="off" required /></label>
			<button type="submit">Start session</button>
		</form>
		<section class="new">
			<h2>New participant</h2>
			{#if created}
				<p><b>{created.pid}</b> (remote, RP) is ready. Send them this link; they open it in Chrome on their own computer:</p>
				<p class="linkbox"><code>{created.link}</code></p>
				<p>
					<button onclick={async () => { await navigator.clipboard.writeText(created!.link); copied = true; }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
					<a href="/admin/remote/{created.pid}" target="_blank">Open facilitator console →</a>
				</p>
				<p class="small"><button onclick={() => ((created = null), (copied = false))}>Create another</button></p>
			{:else}
				<p class="small">Adds the next ID to the schedule (balanced across groups).</p>
				<label class="check"><input type="checkbox" bind:checked={newRemote} /> Remote (RP): they join from their own computer</label>
				<button onclick={newParticipant} disabled={newBusy}>{newRemote ? 'Create remote participant' : 'Create & start here'}</button>
			{/if}
		</section>
		<p class="small"><a href="/admin">Admin</a></p>
	</main>
{:else if loadError}
	<main class="start">
		<h1>Cannot start session</h1>
		<p>{loadError}</p>
		<p><a href="/run">Back to start page</a></p>
	</main>
{:else if !s}
	<main class="start"><p>Loading…</p></main>
{:else if s.aborted}
	<main class="start">
		<h1>This session has ended</h1>
		<p>Thank you for your time. {s.remote ? 'You can close this page.' : 'Please let the researcher know.'}</p>
		{#if laptop || data.laptop}<p class="small">{s.pid} was ended from the facilitator console. <a href="/run">Start page</a></p>{/if}
	</main>
{:else}
	{#key `${s.phase}:${s.phaseStartedAt}`}
		{#if s.phase === 'baseline'}
			{@const start = marker('start')}
			<main class="facil">
				{#if s.remote}
					<h1>Heart-rate strap & baseline</h1>
					{#if ownHr}<OwnHeartRate mgr={ownHr} big />{/if}
					{#if !start}
						<p>Once your heart rate shows above, sit still and relax. Your facilitator will start the baseline.</p>
					{:else}
						<p class="logged">Baseline recording</p>
						<p>Sit still and relax. Your facilitator will move you on.</p>
					{/if}
				{:else}
				<p class="who">{s.pid} · condition <b>{s.condition}</b></p>
				<h1>Sensor fit & baseline</h1>
				{#if !start}
					<p>Fit the heart-rate sensor. Press START at the same moment you press the lap button on the HR monitor.</p>
					<button class="huge" onclick={() => addMarker('start')}>START</button>
				{:else}
					<p class="logged">START logged at {new Date(start.at).toLocaleTimeString()}</p>
					<p>When the baseline is done, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to begin practice.</p>
				{/if}
				{/if}
			</main>
		{:else if s.phase === 'practice'}
			<Board
				board={s.boards.practice}
				manifest={s.manifests[s.boards.practice.theme]}
				colors={s.colors}
				orientations={s.orientations}
				previewMs={s.timers.preview_ms}
				flipMs={s.timers.mismatch_flip_ms}
				practice
				timeLimitMs={s.timers.time_limit_ms}
				onMark={(name, ts) => addMarker(name, ts)}
				onTimeout={() => {
					practiceDone = true;
					addMarker('timeout');
				}}
				onComplete={() => {
					practiceDone = true;
					addMarker('cleared'); // tells the facilitator console
				}}
			/>
		{:else if s.phase === 'interval1' || s.phase === 'interval2'}
			{@const bout = s.phase}
			<Interval
				text={s.text[s.phase]}
				saved={s.progress.bout}
				recordRpe={s.recordRpe}
				metronomeBpm={s.metronomeBpm}
				remote={s.remote}
				durationMs={s.timers.interval_ms[bout]}
				startedAt={marker('start')?.at ?? null}
				onStart={() => addMarker('start')}
				{clockOffset}
				onSave={async (rpe, peak) => {
					await api.bout(s!.pid, bout, rpe, peak);
					if (s && s.phase === bout) s.progress.bout = { rpe, peak_hr: peak };
				}}
			/>
		{:else if s.phase === 'board_a' || s.phase === 'board_b'}
			{@const key = s.phase === 'board_a' ? 'A' : 'B'}
			{@const board = s.boards[key]}
			<Board
				{board}
				manifest={s.manifests[board.theme]}
				colors={s.colors}
				orientations={s.orientations}
				previewMs={s.timers.preview_ms}
				flipMs={s.timers.mismatch_flip_ms}
				priorClicks={s.progress.clicks}
				resumed={!!marker('play')}
				timeLimitMs={s.timers.time_limit_ms}
				elapsedMs={playElapsed()}
				onMark={(name, ts) => addMarker(name, ts)}
				onTimeout={boardTimeout}
				onFlip={(c) => onFlip(key, c)}
				onComplete={() => advance()}
			/>
		{:else if s.phase === 'break'}
			<main class="start">
				<h1>Short break</h1>
				<p>Nice work. Take a moment to relax.</p>
				<p class="waitbig">Wait for facilitator</p>
				{#if !s.remote}<p class="small">Facilitator: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to start the questions.</p>{/if}
			</main>
		{:else if s.phase === 'sa'}
			<Sa
				plan={s.saPlan}
				answered={s.progress.saAnswered}
				manifests={s.manifests}
				colors={s.colors}
				orientations={s.orientations}
				scale={s.confidenceScale}
				labels={s.confidenceLabels}
				oralQuestions={s.oralQuestions}
				level2Hex={s.level2Hex}
				onAnswer={(a) => api.sa(s!.pid, a).catch((e) => say(`Answer not saved: ${e.message}`, 6000))}
				onDone={() => advance()}
				skippable={s.isTest}
			/>
		{:else if s.phase === 'survey'}
			<Survey remote={s.remote} onSubmit={async (v) => setState(await api.survey(s!.pid, v))} />
		{:else}
			<main class="start">
				<h1>Thank you!</h1>
				<p>You're all done. Please let the researcher know.</p>
				{#if s.remote}<p class="small">{s.pid} complete. You can close this page{ownHr?.connected ? ' and take off the strap' : ''}.</p>
				{:else}<p class="small">{s.pid} complete. Facilitator: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> for the start page.</p>{/if}
			</main>
		{/if}
	{/key}
	{#if ownHr && s.phase !== 'baseline' && s.phase !== 'done'}<OwnHeartRate mgr={ownHr} />{/if}
	{#if s.isTest}
		<div class="devbar" class:open={devOpen}>
			<button class="devtoggle" onclick={() => (devOpen = !devOpen)}>
				TEST · {s.phase}{s.devTimers ? ' · fast' : ''} {devOpen ? '▾' : '▸'}
			</button>
			{#if devOpen}
				<div class="devpanel">
					<p>{s.pid} · {s.condition} · A={s.boards.A.theme} B={s.boards.B.theme}</p>
					<div class="devphases">
						{#each PHASES as p (p)}
							<button class:cur={p === s.phase} onclick={() => jump(p)}>{p}</button>
						{/each}
					</div>
					<p class="devrow">
						<button onclick={() => jump(s!.phase)}>Restart phase</button>
						<button onclick={() => jump(s!.phase, !s!.devTimers)}>{s.devTimers ? 'Normal timers' : 'Fast timers'}</button>
						<a href="/admin" target="_blank">Admin</a>
						<a href="/preview" target="_blank">Preview</a>
					</p>
					<p class="devnote">Jumping clears answers from that phase on. Test sessions are left out of the exports.</p>
				</div>
			{/if}
		</div>
	{:else if s.devTimers}<div class="dev">DEV TIMERS</div>{/if}
{/if}

{#if toast}<div class="toast">{toast}</div>{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		background: #fff;
		color: #111;
	}
	.start,
	.facil {
		max-width: 40rem;
		margin: 0 auto;
		padding: 3rem 1.5rem;
		text-align: center;
		font-size: 1.3rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}
	label {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	input {
		font-size: 1.3rem;
		padding: 0.4rem;
		width: 10rem;
	}
	form button {
		font-size: 1.3rem;
		padding: 0.6rem 2rem;
	}
	.new {
		margin: 2.5rem auto 1rem;
		padding: 1rem 1.2rem;
		border: 1px solid #ddd;
		border-radius: 10px;
		font-size: 1rem;
	}
	.new h2 {
		margin-top: 0;
		font-size: 1.2rem;
	}
	.new button {
		font-size: 1rem;
		padding: 0.4rem 1rem;
	}
	.new label.check {
		justify-content: center;
		margin-bottom: 0.6rem;
	}
	.linkbox code {
		font-size: 0.8rem;
		overflow-wrap: anywhere;
		background: #f2f4f7;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
	}
	.huge {
		font-size: 4rem;
		font-weight: 800;
		padding: 2rem 5rem;
		border-radius: 20px;
		border: none;
		background: #2a9d3f;
		color: white;
		cursor: pointer;
		margin-top: 2rem;
	}
	.who {
		color: #555;
		font-size: 1rem;
	}
	.logged {
		font-size: 2rem;
		color: #2a9d3f;
		font-weight: 700;
	}
	.waitbig {
		margin: 2.5rem 0;
		font-size: 2.4rem;
		font-weight: 700;
		color: #1f63d6;
	}
	.small {
		font-size: 0.9rem;
		color: #777;
	}
	kbd {
		border: 1px solid #aaa;
		border-radius: 4px;
		padding: 0 0.3em;
		background: #f4f4f4;
	}
	.toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: #222;
		color: white;
		padding: 0.7rem 1.4rem;
		border-radius: 8px;
		font-size: 1.1rem;
		z-index: 10;
	}
	.devbar {
		position: fixed;
		top: 0.4rem;
		right: 0.4rem;
		z-index: 20;
		font-size: 0.8rem;
		text-align: right;
	}
	.devtoggle {
		background: #7b2cbf;
		color: white;
		border: none;
		border-radius: 4px;
		font-weight: 700;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
		opacity: 0.85;
	}
	.devpanel {
		margin-top: 0.3rem;
		background: white;
		border: 2px solid #7b2cbf;
		border-radius: 8px;
		padding: 0.6rem;
		width: 20rem;
		text-align: left;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
	}
	.devpanel p {
		margin: 0.3rem 0;
	}
	.devphases {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.devphases button.cur {
		background: #7b2cbf;
		color: white;
	}
	.devrow {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.devnote {
		color: #777;
		font-size: 0.75rem;
	}
	.dev {
		position: fixed;
		top: 0.4rem;
		right: 0.4rem;
		background: #e0a800;
		color: black;
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
	}
</style>

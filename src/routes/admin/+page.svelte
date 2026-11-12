<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	let password = $state('');
	let loginError = $state('');

	async function doLogin(e: SubmitEvent) {
		e.preventDefault();
		const r = await fetch('/admin/auth', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password })
		});
		loginError = r.ok ? '' : 'Wrong password';
		if (r.ok) invalidateAll();
	}
	let selected = $state<string[]>([]);
	let notice = $state('');

	async function dataAction(payload: Record<string, unknown>) {
		const r = await fetch('/admin/data', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		notice = r.ok ? '' : `Failed: ${(await r.json().catch(() => ({}))).message ?? r.statusText}`;
		selected = [];
		await invalidateAll();
		return r.ok;
	}
	async function deletePids(pids: string[]) {
		if (!pids.length) return;
		if (!confirm(`Delete ALL data for ${pids.join(', ')}? They can then start over from the beginning. This cannot be undone.`)) return;
		if (await dataAction({ action: 'delete', pids })) notice = `Deleted ${pids.join(', ')}.`;
	}
	async function resetAll() {
		const typed = prompt('This deletes every session, click, answer and survey (the schedule is kept).\nDownload the CSVs first if you need them.\n\nType RESET to confirm:');
		if (typed !== 'RESET') return;
		if (await dataAction({ action: 'reset', confirm: 'RESET' })) notice = 'All data deleted.';
	}
	// Test run-through
	let tCondition = $state('');
	let tOrder = $state(0);
	let tPhase = $state('baseline');
	let tFast = $state(true);
	async function testAction(payload: Record<string, unknown>) {
		const r = await fetch('/admin/test', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const out = await r.json().catch(() => ({}));
		notice = r.ok ? '' : `Failed: ${out.message ?? r.statusText}`;
		await invalidateAll();
		return r.ok ? out : null;
	}
	async function createTest() {
		if (!data.authed) return;
		const [a, b] = data.test.themeOrders[tOrder];
		const out = await testAction({
			action: 'create',
			condition: tCondition || data.test.conditions[0],
			board_a_theme: a,
			board_b_theme: b,
			phase: tPhase,
			fast: tFast
		});
		if (out?.pid) {
			notice = `Created ${out.pid}.`;
			window.open(`/?pid=${encodeURIComponent(out.pid)}`, '_blank');
		}
	}
	async function jumpTest(pid: string, phase: string) {
		if (await testAction({ action: 'jump', pid, phase })) notice = `${pid} moved to ${phase}.`;
	}
	const isTest = (pid: string) => pid.startsWith('TEST-');

	const toggle = (pid: string) =>
		(selected = selected.includes(pid) ? selected.filter((p) => p !== pid) : [...selected, pid]);

	async function doLogout() {
		await fetch('/admin/auth', { method: 'DELETE' });
		invalidateAll();
	}

	onMount(() => {
		const t = setInterval(() => data.authed && invalidateAll(), 3000);
		return () => clearInterval(t);
	});

	const ago = (ms: number) => {
		const s = Math.max(0, Math.round(ms / 1000));
		return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	};
	const time = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '');
	const EXPORTS = ['summary', 'sessions', 'phases', 'clicks', 'sa_responses', 'bouts', 'survey'];
</script>

<svelte:head><title>Admin · Concentration study</title></svelte:head>

<main>
	{#if !data.authed}
		<h1>Admin</h1>
		{#if !data.enabled}
			<p>Admin is disabled: set the <code>ADMIN_PASSWORD</code> environment variable and restart.</p>
		{:else}
			<form onsubmit={doLogin}>
				<input type="password" bind:value={password} placeholder="Password" autocomplete="current-password" required />
				<button>Log in</button>
			</form>
			{#if loginError}<p class="err">{loginError}</p>{/if}
		{/if}
	{:else}
		<header>
			<h1>Admin</h1>
			<button onclick={doLogout}>Log out</button>
		</header>
		{#if data.devTimers}<p class="warn">DEV_TIMERS is on: the card preview is 5 s. Do not collect real data.</p>{/if}

		{#if notice}<p class="notice">{notice}</p>{/if}

		<h2>In progress</h2>
		{#if !data.active.length}<p>No sessions in progress.</p>{/if}
		<div class="stations">
			{#each data.active as st (st.pid)}
				<div class="station">
					<div class="name">{st.pid}</div>
					<div>{st.condition}</div>
					<div class="phase">{st.phase}</div>
					<div>in phase {ago(data.now - st.phase_started_at)}</div>
					<div class="muted">last activity {ago(data.now - st.updated_at)} ago</div>
				</div>
			{/each}
		</div>

		<h2>Test run</h2>
		<div class="testrun">
			<label>Condition
				<select bind:value={tCondition}>
					{#each data.test.conditions as c (c)}<option value={c}>{c}</option>{/each}
				</select>
			</label>
			<label>Boards
				<select bind:value={tOrder}>
					{#each data.test.themeOrders as o, i (i)}<option value={i}>A={o[0]}, B={o[1]}</option>{/each}
				</select>
			</label>
			<label>Start at
				<select bind:value={tPhase}>
					{#each data.test.phases as p (p)}<option value={p}>{p}</option>{/each}
				</select>
			</label>
			<label><input type="checkbox" bind:checked={tFast} /> Fast timers (5 s preview)</label>
			<button class="primary" onclick={createTest}>Create test session &amp; open</button>
			<a href="/preview" target="_blank">Icon / question preview →</a>
		</div>
		<p class="muted small">
			Test sessions are named TEST-n, are left out of every export, and have a purple developer toolbar
			(top right) for jumping to any phase. Delete them below when you're done.
		</p>

		<h2>Export</h2>
		<p class="exports">
			{#each EXPORTS as name (name)}
				<a href="/admin/export/{name}.csv" download>{name}.csv</a>
			{/each}
		</p>

		<h2>Sessions ({data.sessions.length})</h2>
		<p class="tools">
			<button disabled={!selected.length} onclick={() => deletePids(selected)}>Delete selected ({selected.length})</button>
			<button class="danger" onclick={resetAll}>Reset all data…</button>
		</p>
		<table>
			<thead>
				<tr>
					<th></th><th>PID</th><th>Condition</th><th>Board A</th><th>Board B</th><th>Phase</th><th>Clicks</th>
					<th>SA</th><th>Reloads</th><th>Started</th><th>Completed</th><th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.sessions as r (r.pid)}
					<tr>
						<td><input type="checkbox" checked={selected.includes(r.pid)} onchange={() => toggle(r.pid)} /></td>
						<td>{r.pid}{#if isTest(r.pid)} <span class="tag">test</span>{/if}</td><td>{r.condition}</td><td>{r.board_a_theme}</td><td>{r.board_b_theme}</td>
						<td>{r.phase}</td><td>{r.clicks}</td><td>{r.sa_answered}/{r.sa_total}</td>
						<td class:warnc={r.reloads > 0}>{r.reloads}</td><td>{time(r.created_at)}</td><td>{time(r.completed_at)}</td>
						<td class="nowrap">
							{#if isTest(r.pid)}
								<a class="small" href="/?pid={r.pid}" target="_blank">Open</a>
								<select class="small" value="" onchange={(e) => jumpTest(r.pid, e.currentTarget.value)}>
									<option value="" disabled>Jump to…</option>
									{#each data.test.phases as p (p)}<option value={p}>{p}</option>{/each}
								</select>
							{/if}
							<button class="small" onclick={() => deletePids([r.pid])}>Delete</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<h2>Schedule ({data.schedule.filter((r) => r.started).length}/{data.schedule.length} started)</h2>
		{#if !data.schedule.length}
			<p class="warn">No schedule found. Run <code>npm run schedule</code>.</p>
		{/if}
		<table>
			<thead><tr><th>PID</th><th>Condition</th><th>Board A</th><th>Board B</th><th>Status</th></tr></thead>
			<tbody>
				{#each data.schedule as r (r.pid)}
					<tr class:muted={r.started}>
						<td>{r.pid}{#if isTest(r.pid)} <span class="tag">test</span>{/if}</td><td>{r.condition}</td><td>{r.board_a_theme}</td><td>{r.board_b_theme}</td>
						<td>{r.started ? 'started' : ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
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
		max-width: 70rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.stations {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.station {
		border: 2px solid #1f63d6;
		border-radius: 10px;
		padding: 0.8rem 1rem;
		min-width: 12rem;
	}
	.tools {
		display: flex;
		gap: 1rem;
	}
	.testrun {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem 1.2rem;
		align-items: center;
		border: 2px dashed #7b2cbf;
		border-radius: 10px;
		padding: 0.8rem 1rem;
	}
	.primary {
		background: #7b2cbf;
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.4rem 0.9rem;
		cursor: pointer;
	}
	.tag {
		background: #efe3fb;
		color: #7b2cbf;
		font-size: 0.7rem;
		padding: 0 0.3rem;
		border-radius: 3px;
	}
	.small {
		font-size: 0.8rem;
	}
	.nowrap {
		white-space: nowrap;
	}
	.danger {
		color: #b00;
		border-color: #b00;
	}
	.notice {
		background: #e8f6ec;
		padding: 0.5rem 1rem;
		border-radius: 6px;
	}
	button.small {
		font-size: 0.8rem;
	}
	.name {
		font-size: 1.4rem;
		font-weight: 700;
	}
	.phase {
		font-size: 1.2rem;
		font-weight: 600;
		color: #1f63d6;
	}
	.muted {
		color: #888;
	}
	.exports {
		display: flex;
		gap: 1.2rem;
		flex-wrap: wrap;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.9rem;
	}
	th,
	td {
		border-bottom: 1px solid #ddd;
		padding: 0.3rem 0.5rem;
		text-align: left;
	}
	.warn {
		background: #fff4cc;
		padding: 0.5rem 1rem;
		border-radius: 6px;
	}
	.warnc {
		color: #b06000;
		font-weight: 700;
	}
	.err {
		color: #b00;
	}
</style>

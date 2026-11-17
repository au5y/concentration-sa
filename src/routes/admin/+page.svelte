<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import HeartRatePanel from '$lib/components/HeartRatePanel.svelte';
	import LandingEditor from '$lib/components/LandingEditor.svelte';
	import TagPresetsEditor from '$lib/components/TagPresetsEditor.svelte';

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
	async function archivePid(pid: string) {
		const tag = prompt(
			`Archive ${pid}? Their data is kept (renamed ARCHIVE-<tag>-${pid}), shown here and in the archive exports, ` +
				`but left out of the normal exports. ${pid} can then be run again.\n\nTag for this version of the test (e.g. v1):`,
			'v1'
		);
		if (!tag) return;
		const r = await dataAction({ action: 'archive', pid, tag });
		if (r) notice = `Archived ${pid}.`;
	}
	let addCount = $state(4);
	async function addParticipants() {
		if (!confirm(`Add ${addCount} participant${addCount === 1 ? '' : 's'} to the end of the schedule? Existing IDs and assignments are not changed.`)) return;
		const r = await fetch('/admin/schedule', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ add: addCount })
		});
		const res = await r.json().catch(() => ({}));
		notice = r.ok ? `Added ${res.added.join(', ')}.` : `Failed: ${res.message ?? r.statusText}`;
		await invalidateAll();
	}
	async function resetAll() {
		const typed = prompt('This deletes every session, click, answer and survey (the schedule is kept).\nDownload the CSVs first if you need them.\n\nType RESET to confirm:');
		if (typed !== 'RESET') return;
		if (await dataAction({ action: 'reset', confirm: 'RESET' })) notice = 'All data deleted.';
	}
	// Test run-through
	let tCondition = $state('');
	let tOrder = $state(0);
	let tPhase = $state('survey');
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
			window.open(`/run?pid=${encodeURIComponent(out.pid)}`, '_blank');
		}
	}
	async function jumpTest(pid: string, phase: string) {
		if (await testAction({ action: 'jump', pid, phase })) notice = `${pid} moved to ${phase}.`;
	}
	// Editing a participant (corrections and tags). The form works on a copy so the 3 s refresh
	// doesn't overwrite what is being typed.
	type Bout = { rpe: number | null; peak_hr: number | null };
	type Form = {
		pid: string;
		condition: string;
		tags: string;
		survey: { age: number; exercise_days: number; fitness: number; hours_slept: number } | null;
		bouts: { interval1: Bout; interval2: Bout };
	};
	let editing = $state<string | null>(null);
	let form = $state<Form | null>(null);
	const splitTags = (t: string | null | undefined) => (t ?? '').split(',').map((x) => x.trim()).filter(Boolean);
	/** Tags on any session, and the suggested ones followed by any others in use (for the edit form). */
	const usedTags = $derived(
		data.authed ? [...new Set(data.sessions.flatMap((r) => splitTags(r.tags)))].sort((a, b) => a.localeCompare(b)) : []
	);
	const allTags = $derived(
		data.authed
			? [...data.tagPresets, ...usedTags.filter((t) => !data.tagPresets.some((p) => p.toLowerCase() === t.toLowerCase()))]
			: []
	);
	function openEdit(r: { pid: string; condition: string; tags: string }) {
		if (!data.authed) return;
		const b = data.bouts[r.pid] ?? {};
		const bout = (k: string): Bout => ({ rpe: b[k]?.rpe ?? null, peak_hr: b[k]?.peak_hr ?? null });
		const sv = data.surveys[r.pid];
		form = {
			pid: r.pid,
			condition: r.condition,
			tags: splitTags(r.tags).join(', '),
			survey: sv ? { ...sv } : null,
			bouts: { interval1: bout('interval1'), interval2: bout('interval2') }
		};
		editing = r.pid;
	}
	function toggleTag(t: string) {
		if (!form) return;
		const cur = splitTags(form.tags);
		const has = cur.some((c) => c.toLowerCase() === t.toLowerCase());
		form.tags = (has ? cur.filter((c) => c.toLowerCase() !== t.toLowerCase()) : [...cur, t]).join(', ');
	}
	const hasTag = (t: string) => !!form && splitTags(form.tags).some((c) => c.toLowerCase() === t.toLowerCase());
	/** What the schedule says about the new pid, if it differs from this session. */
	function pidNote(r: { pid: string; condition: string; board_a_theme: string; board_b_theme: string }, to: string): string {
		if (!data.authed || !to || to === r.pid) return '';
		if (data.sessions.some((s) => s.pid === to)) return `${to} already has a session; pick another ID.`;
		const sch = data.schedule.find((x) => x.pid === to);
		if (!sch) return `${to} is not in the schedule (that's fine for the data, just so you know).`;
		const diff = [
			sch.condition !== (form?.condition ?? r.condition) && `condition ${sch.condition}`,
			sch.board_a_theme !== r.board_a_theme && `Board A ${sch.board_a_theme}`,
			sch.board_b_theme !== r.board_b_theme && `Board B ${sch.board_b_theme}`
		].filter(Boolean);
		return diff.length ? `The schedule has ${to} as ${diff.join(', ')}; this session keeps what was actually run.` : '';
	}
	async function saveEdit(r: { pid: string; phase: string }) {
		if (!form || !data.authed) return;
		const to = form.pid.trim();
		const bouts: Record<string, { rpe: number; peak_hr: number | null } | null> = {};
		for (const k of ['interval1', 'interval2'] as const) {
			const v = form.bouts[k];
			const had = !!data.bouts[r.pid]?.[k];
			if (v.rpe === null && v.peak_hr === null) {
				if (had) bouts[k] = null;
			} else if (v.rpe === null) {
				notice = `Failed: ${k === 'interval1' ? 'Bout 1' : 'Bout 2'} needs an RPE (or clear both fields to remove it).`;
				return;
			} else bouts[k] = { rpe: v.rpe, peak_hr: v.peak_hr };
		}
		if (to !== r.pid) {
			const live = r.phase !== 'done';
			const msg =
				`Change participant ID ${r.pid} → ${to}? All of their data moves to ${to}, and ${r.pid} can be run again.` +
				(live ? `\n\nThis session is still in progress: reopen the study page with ?pid=${to} and reassign their heart-rate strap.` : '');
			if (!confirm(msg)) return;
		}
		const ok = await dataAction({
			action: 'edit',
			pid: r.pid,
			changes: {
				pid: to,
				condition: form.condition,
				tags: splitTags(form.tags),
				...(form.survey ? { survey: form.survey } : {}),
				bouts
			}
		});
		if (ok) {
			notice = `Saved ${to}.`;
			editing = null;
			form = null;
		}
	}
	const editsFor = (pid: string) => (data.authed ? data.edits.filter((e) => e.pid === pid) : []);
	const show = (v: string | null) => (v === null || v === '' ? '—' : v);

	const isTest = (pid: string) => pid.startsWith('TEST-');
	const isArchived = (pid: string) => pid.startsWith('ARCHIVE-');

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
	const EXPORTS = ['summary', 'sessions', 'phases', 'clicks', 'sa_responses', 'bouts', 'survey', 'hr_samples', 'edits'];
</script>

<svelte:head><title>Admin · Pump Up the Memory: HSE Study</title></svelte:head>

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

		<LandingEditor landing={data.landing} />

		<HeartRatePanel pids={data.active.map((a) => a.pid)} heard={data.straps} now={data.now} />

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

		<h2>Data</h2>
		<p><a class="explore" href="/admin/explore">Open the data explorer →</a> <span class="muted small">Per-participant boards, timelines, answers and condition averages.</span></p>
		<h3>Export</h3>
		<p class="exports">
			{#each EXPORTS as name (name)}
				<a href="/admin/export/{name}.csv" download>{name}.csv</a>
			{/each}
		</p>
		{#if data.sessions.some((r) => isArchived(r.pid))}
			<h3>Archive</h3>
			<p class="muted small">Sessions from earlier versions of the test (ARCHIVE-…). Kept, but not in the exports above.</p>
			<p class="exports">
				{#each EXPORTS as name (name)}
					<a href="/admin/export/archive_{name}.csv" download>archive_{name}.csv</a>
				{/each}
			</p>
		{/if}

		<h2>Sessions ({data.sessions.length})</h2>
		<p class="tools">
			<button disabled={!selected.length} onclick={() => deletePids(selected)}>Delete selected ({selected.length})</button>
			<button class="danger" onclick={resetAll}>Reset all data…</button>
		</p>
		<table>
			<thead>
				<tr>
					<th></th><th>PID</th><th>Condition</th><th>Tags</th><th>Board A</th><th>Board B</th><th>Phase</th><th>Clicks</th>
					<th>SA</th><th>Reloads</th><th>Started</th><th>Completed</th><th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.sessions as r (r.pid)}
					<tr>
						<td><input type="checkbox" checked={selected.includes(r.pid)} onchange={() => toggle(r.pid)} /></td>
						<td><a href="/admin/explore?pid={encodeURIComponent(r.pid)}">{r.pid}</a>{#if isTest(r.pid)} <span class="tag">test</span>{:else if isArchived(r.pid)} <span class="tag">archived</span>{/if}</td><td>{r.condition}</td>
						<td>{#each splitTags(r.tags) as t (t)}<span class="chip">{t}</span>{/each}</td><td>{r.board_a_theme}</td><td>{r.board_b_theme}</td>
						<td>{r.phase}</td><td>{r.clicks}</td><td>{r.sa_answered}/{r.sa_total}</td>
						<td class:warnc={r.reloads > 0}>{r.reloads}</td><td>{time(r.created_at)}</td><td>{time(r.completed_at)}</td>
						<td class="nowrap">
							<button class="small" onclick={() => (editing === r.pid ? (editing = null) : openEdit(r))}>{editing === r.pid ? 'Close' : 'Edit'}</button>
							{#if isTest(r.pid)}
								<a class="small" href="/run?pid={r.pid}" target="_blank">Open</a>
								<select class="small" value="" onchange={(e) => jumpTest(r.pid, e.currentTarget.value)}>
									<option value="" disabled>Jump to…</option>
									{#each data.test.phases as p (p)}<option value={p}>{p}</option>{/each}
								</select>
							{:else if !isArchived(r.pid)}
								<button class="small" onclick={() => archivePid(r.pid)}>Archive</button>
							{/if}
							<button class="small" onclick={() => deletePids([r.pid])}>Delete</button>
						</td>
					</tr>
					{#if editing === r.pid && form}
						<tr class="editrow">
							<td colspan="13">
								<form class="edit" onsubmit={(e) => (e.preventDefault(), saveEdit(r))}>
									<fieldset>
										<legend>Participant</legend>
										<label>ID <input bind:value={form.pid} size="12" required /></label>
										<label>Condition
											<select bind:value={form.condition}>
												{#each data.conditions as c (c)}<option value={c}>{c}</option>{/each}
											</select>
										</label>
										{#if pidNote(r, form.pid.trim())}<p class="hint">{pidNote(r, form.pid.trim())}</p>{/if}
									</fieldset>
									<fieldset class="tags">
										<legend>Tags</legend>
										<input bind:value={form.tags} placeholder="e.g. stairs, late start" size="36" />
										{#if allTags.length}
											<div class="chips">
												{#each allTags as t (t)}
													<button type="button" class="chip" class:on={hasTag(t)} onclick={() => toggleTag(t)}>{t}</button>
												{/each}
											</div>
										{/if}
										<p class="hint">Click a suggestion or type your own, comma separated. Edit the suggestions at the bottom of this page.</p>
									</fieldset>
									<fieldset>
										<legend>Survey</legend>
										{#if form.survey}
											<label>Age <input type="number" min="16" max="99" bind:value={form.survey.age} required /></label>
											<label>Exercise days/wk <input type="number" min="0" max="7" bind:value={form.survey.exercise_days} required /></label>
											<label>Fitness (1-5) <input type="number" min="1" max="5" bind:value={form.survey.fitness} required /></label>
											<label>Hours slept <input type="number" min="0" max="24" step="any" bind:value={form.survey.hours_slept} required /></label>
										{:else}
											<p class="hint">Not filled in yet.</p>
										{/if}
									</fieldset>
									<fieldset>
										<legend>Exercise / rest bouts</legend>
										{#each [['interval1', 'Bout 1 (before A)'], ['interval2', 'Bout 2 (before B)']] as [k, label] (k)}
											<div class="bout">
												<span>{label}</span>
												<label>RPE <input type="number" min="6" max="20" bind:value={form.bouts[k as 'interval1'].rpe} /></label>
												<label>Peak HR <input type="number" min="30" max="250" bind:value={form.bouts[k as 'interval1'].peak_hr} /></label>
											</div>
										{/each}
										<p class="hint">Clear both fields to remove a bout's entry.</p>
									</fieldset>
									<div class="actions">
										<button class="primary">Save changes</button>
										<button type="button" onclick={() => ((editing = null), (form = null))}>Cancel</button>
									</div>
								</form>
								{#if editsFor(r.pid).length}
									<details class="history">
										<summary>Change history ({editsFor(r.pid).length})</summary>
										<table>
											<tbody>
												{#each editsFor(r.pid) as e, i (i)}
													<tr><td>{time(e.server_ts)}</td><td>{e.field}</td><td>{show(e.old_value)} → {show(e.new_value)}</td></tr>
												{/each}
											</tbody>
										</table>
									</details>
								{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>

		<h2>Schedule ({data.schedule.filter((r) => r.started).length}/{data.schedule.length} started)</h2>
		{#if !data.schedule.length}
			<p class="warn">No schedule found. Run <code>npm run schedule</code>.</p>
		{:else}
			<p class="add-participants">
				<label>Add <input type="number" min="1" max="100" bind:value={addCount} /> participants</label>
				<button onclick={addParticipants} disabled={!(addCount >= 1 && addCount <= 100)}>Add to schedule</button>
				<span class="muted">New IDs continue after {data.schedule.at(-1)?.pid}, balanced across the {data.conditions.length * data.test.themeOrders.length} condition × theme-order groups. Add 4 at a time to keep the groups even.</span>
			</p>
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

		<TagPresetsEditor presets={data.tagPresets} inUse={usedTags} />
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		background: #fff;
		color: #111;
	}
	.add-participants {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.add-participants input {
		width: 4rem;
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
	.explore {
		font-weight: 600;
		font-size: 1.1rem;
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
	.chip {
		display: inline-block;
		background: #e6effc;
		color: #1f4f9e;
		border: 1px solid #c3d6f5;
		border-radius: 999px;
		font-size: 0.75rem;
		padding: 0 0.5rem;
		margin: 0 0.2rem 0.2rem 0;
	}
	button.chip {
		cursor: pointer;
		background: #fff;
		color: #555;
		border-color: #ccc;
	}
	button.chip.on {
		background: #1f63d6;
		color: #fff;
		border-color: #1f63d6;
	}
	.editrow > td {
		background: #f6f8fc;
		padding: 0.8rem;
	}
	.edit {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		align-items: flex-start;
	}
	.edit fieldset {
		border: 1px solid #d5dbe6;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 22rem;
	}
	.edit label {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
	}
	.edit input[type='number'] {
		width: 4.5rem;
	}
	.bout {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.bout > span {
		min-width: 8rem;
		font-size: 0.85rem;
	}
	.hint {
		margin: 0;
		color: #777;
		font-size: 0.78rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		align-self: flex-end;
	}
	.history {
		margin-top: 0.6rem;
		font-size: 0.85rem;
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

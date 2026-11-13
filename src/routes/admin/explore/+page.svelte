<script lang="ts">
	import ObjectImage from '$lib/components/ObjectImage.svelte';
	import { renderSpec } from '$lib/render';

	let { data } = $props();

	type Row = Record<string, any>;
	const rows = $derived(data.rows as Row[]);

	// ---------- formatting ----------
	const dash = '–';
	const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
	const pct = (v: unknown) => (isNum(v) ? `${Math.round(v * 100)}%` : dash);
	const num = (v: unknown, d = 1) => (isNum(v) ? v.toFixed(d) : dash);
	const int = (v: unknown) => (isNum(v) ? String(Math.round(v)) : dash);
	const secs = (ms: unknown) => (isNum(ms) ? `${(ms / 1000).toFixed(1)} s` : dash);
	const clock = (ms: unknown) => (isNum(ms) ? new Date(ms).toLocaleTimeString() : dash);
	const dateTime = (ms: unknown) => (isNum(ms) ? new Date(ms).toLocaleString() : dash);
	const mean = (xs: unknown[]) => {
		const v = xs.filter(isNum);
		return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
	};
	/** Board result: clear time, or "time up" with pairs found. */
	const boardCell = (r: Row, b: 'A' | 'B') =>
		r[`${b}_timed_out`] ? `time up · ${r[`${b}_pairs_found`]}/${data.boardPairs}` : r[`${b}_cleared`] ? secs(r[`${b}_time_to_clear_ms`]) : dash;
	const qs = (extra: Record<string, string | null>) => {
		const p = new URLSearchParams();
		if (data.includeTests) p.set('tests', '1');
		for (const [k, v] of Object.entries(extra)) if (v !== null) p.set(k, v);
		const s = p.toString();
		return s ? `?${s}` : '?';
	};

	// ---------- overview ----------
	const completed = $derived(rows.filter((r) => r.completed).length);
	const boardsPlayed = $derived(rows.reduce((n, r) => n + (r.A_total_flips ? 1 : 0) + (r.B_total_flips ? 1 : 0), 0));
	const timeouts = $derived(rows.reduce((n, r) => n + (r.A_timed_out ?? 0) + (r.B_timed_out ?? 0), 0));
	const byCondition = $derived(
		[...new Set(rows.map((r) => r.condition))].sort().map((c) => {
			const g = rows.filter((r) => r.condition === c);
			const col = (k: string) => mean(g.map((r) => r[k]));
			return {
				condition: c,
				n: g.length,
				completed: g.filter((r) => r.completed).length,
				A_time: col('A_time_to_clear_ms'),
				B_time: col('B_time_to_clear_ms'),
				A_mis: col('A_mismatches'),
				B_mis: col('B_mismatches'),
				timeouts: g.reduce((n, r) => n + (r.A_timed_out ?? 0) + (r.B_timed_out ?? 0), 0),
				memory: col('memory_acc'),
				level2: col('level2_acc'),
				env: col('sa_env_acc'),
				dprime: col('q_objects_dprime'),
				rpe1: col('rpe_1'),
				rpe2: col('rpe_2'),
				hr1: col('peak_hr_1'),
				hr2: col('peak_hr_2')
			};
		})
	);

	// ---------- sortable participant table ----------
	interface Col {
		key: string;
		label: string;
		title?: string;
		sort: (r: Row) => number | string | null;
		show: (r: Row) => string;
	}
	const board = (b: 'A' | 'B'): Col[] => [
		{
			key: `${b}_time`,
			label: `${b} time`,
			title: `Board ${b}: time to clear (or pairs found if time ran out)`,
			sort: (r) => (r[`${b}_timed_out`] ? 1e9 - (r[`${b}_pairs_found`] ?? 0) : r[`${b}_time_to_clear_ms`]),
			show: (r) => boardCell(r, b)
		},
		{ key: `${b}_mis`, label: `${b} errors`, title: `Board ${b}: mismatches`, sort: (r) => r[`${b}_mismatches`], show: (r) => int(r[`${b}_mismatches`]) },
		{ key: `${b}_eff`, label: `${b} eff.`, title: `Board ${b}: pairs found / moves`, sort: (r) => r[`${b}_efficiency`], show: (r) => pct(r[`${b}_efficiency`]) }
	];
	const COLS: Col[] = [
		{ key: 'pid', label: 'PID', sort: (r) => r.pid, show: (r) => r.pid },
		{ key: 'condition', label: 'Condition', sort: (r) => r.condition, show: (r) => r.condition },
		{ key: 'status', label: 'Status', sort: (r) => (r.completed ? 'zz' : r.final_phase), show: (r) => (r.completed ? 'done' : r.final_phase) },
		...board('A'),
		...board('B'),
		{ key: 'memory', label: 'Memory', title: 'Level 1 card questions accuracy (color, side-by-side)', sort: (r) => r.memory_acc, show: (r) => pct(r.memory_acc) },
		{ key: 'level2', label: 'Level 2', title: 'Level 2 card questions accuracy (same color as, how many)', sort: (r) => r.level2_acc, show: (r) => pct(r.level2_acc) },
		{ key: 'env', label: 'SA env', title: 'Spoken environment questions accuracy', sort: (r) => r.sa_env_acc, show: (r) => pct(r.sa_env_acc) },
		{ key: 'dprime', label: "Objects d′", title: 'Recognition grid sensitivity', sort: (r) => r.q_objects_dprime, show: (r) => num(r.q_objects_dprime, 2) },
		{ key: 'rpe1', label: 'RPE 1', sort: (r) => r.rpe_1, show: (r) => int(r.rpe_1) },
		{ key: 'rpe2', label: 'RPE 2', sort: (r) => r.rpe_2, show: (r) => int(r.rpe_2) },
		{ key: 'hr1', label: 'HR 1', title: 'Peak HR, bout 1', sort: (r) => r.peak_hr_1, show: (r) => int(r.peak_hr_1) },
		{ key: 'hr2', label: 'HR 2', title: 'Peak HR, bout 2', sort: (r) => r.peak_hr_2, show: (r) => int(r.peak_hr_2) }
	];
	let sortKey = $state('pid');
	let sortDir = $state<1 | -1>(1);
	const sorted = $derived.by(() => {
		const col = COLS.find((c) => c.key === sortKey) ?? COLS[0];
		return rows.slice().sort((a, b) => {
			const x = col.sort(a);
			const y = col.sort(b);
			if (x === y) return 0;
			if (x === null || x === undefined) return 1; // blanks last
			if (y === null || y === undefined) return -1;
			return (x < y ? -1 : 1) * sortDir;
		});
	});
	function sortBy(key: string) {
		if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortKey = key;
			sortDir = 1;
		}
	}

	// ---------- participant detail ----------
	// Rows come straight from SQLite, so treat them as plain records.
	const d = $derived(data.detail as Row | null);
	const MAIN = ['baseline', 'practice', 'interval1', 'board_a', 'interval2', 'board_b', 'sa', 'survey', 'done'];
	const PHASE_LABEL: Record<string, string> = {
		baseline: 'Baseline',
		practice: 'Practice',
		interval1: 'Exercise / rest 1',
		board_a: 'Board A',
		interval2: 'Exercise / rest 2',
		board_b: 'Board B',
		sa: 'SA questions',
		survey: 'Survey',
		done: 'Done'
	};
	const timeline = $derived.by(() => {
		if (!d) return [];
		return d.phases
			.filter((p: Row) => MAIN.includes(p.phase))
			.map((p: Row) => ({
				...p,
				markers: d.phases
					.filter((m: Row) => m.phase.startsWith(`${p.phase}.`) && m.started_at >= p.started_at && (!p.ended_at || m.started_at <= p.ended_at))
					.map((m: Row) => ({ name: m.phase.slice(p.phase.length + 1), offset: m.started_at - p.started_at }))
			}));
	});

	function boardView(key: 'A' | 'B') {
		if (!d) return null;
		const phase = key === 'A' ? 'board_a' : 'board_b';
		const theme = key === 'A' ? d.session.board_a_theme : d.session.board_b_theme;
		const layout = d.layouts[theme];
		const manifest = d.manifests[theme];
		if (!layout || !manifest) return null;
		const clicks = d.clicks.filter((c: Row) => c.board === key);
		const play = d.phases.filter((p: Row) => p.phase === `${phase}.play`).at(-1);
		const t0 = play?.client_started_at ?? clicks[0]?.client_ts ?? 0;
		const flips = new Array(layout.cards.length).fill(0);
		const matchOrder = new Array(layout.cards.length).fill(0);
		let pending: Row | null = null;
		let order = 0;
		for (const c of clicks) {
			flips[c.card_index]++;
			if (c.outcome === 'first_flip') pending = c;
			else {
				if (c.outcome === 'match') {
					order++;
					matchOrder[c.card_index] = order;
					if (pending) matchOrder[pending.card_index] = order;
				}
				pending = null;
			}
		}
		const items = new Map(manifest.objects.map((o: Row) => [o.id, o]));
		const maxFlips = Math.max(1, ...flips);
		return {
			key,
			theme,
			layout,
			cells: layout.cards.map((id: string, i: number) => ({
				id,
				label: (items.get(id) as Row | undefined)?.label ?? id,
				spec: items.get(id) ? renderSpec(theme, items.get(id) as any, d.colors, d.orientations) : null,
				flips: flips[i],
				heat: flips[i] / maxFlips,
				match: matchOrder[i]
			})),
			clicks: clicks.map((c: Row) => ({ ...c, t: (c.client_ts - t0) / 1000, label: (items.get(c.object_id) as Row | undefined)?.label ?? c.object_id })),
			timedOut: d.phases.some((p: Row) => p.phase === `${phase}.timeout`),
			played: clicks.length > 0 || !!play
		};
	}
	const boards = $derived(d ? [boardView('A'), boardView('B')].filter((b) => b !== null) : []);
	const s = $derived((d?.summary ?? {}) as Row);
	const hrMax = $derived(d?.survey?.age ? 220 - (d.survey.age as number) : null);
	const saGroups = $derived.by(() => {
		if (!d) return [];
		const types = [...new Set(d.sa.map((r: Row) => r.question_type as string))];
		return types.map((t) => {
			const g = d.sa.filter((r: Row) => r.question_type === t && r.response !== 'color_blind' && !(t === 'oral' && r.target === ''));
			return { type: t, n: g.length, acc: mean(g.map((r: Row) => r.correct)) };
		});
	});
	/** The recognition grid gives one row per item; summarize it per board instead of listing every row. */
	const grids = $derived.by(() => {
		if (!d) return [];
		return [...new Set(d.sa.filter((r: Row) => r.question_type === 'objects').map((r: Row) => r.board as string))].map((b) => {
			const g = d.sa.filter((r: Row) => r.question_type === 'objects' && r.board === b);
			const seen = g.filter((r: Row) => r.target === 'seen');
			const foils = g.filter((r: Row) => r.target === 'foil');
			return {
				board: b,
				rows: g,
				hits: seen.filter((r: Row) => r.response === 'selected').length,
				seen: seen.length,
				fas: foils.filter((r: Row) => r.response === 'selected').length,
				foils: foils.length,
				rt: g[0]?.rt_ms
			};
		});
	});
	const singles = $derived(d ? d.sa.filter((r: Row) => r.question_type !== 'objects') : []);
	const RESPONSE_LABEL: Record<string, string> = { dont_remember: "don't remember", color_blind: 'color blind', not_selected: '—' };
</script>

<svelte:head><title>Data explorer · Concentration study</title></svelte:head>

<main>
	<header>
		<div>
			<a class="back" href="/admin">← Admin</a>
			<h1>Data explorer</h1>
		</div>
		<label class="toggle">
			<input
				type="checkbox"
				checked={data.includeTests}
				onchange={(e) => {
					const p = new URLSearchParams(location.search);
					if (e.currentTarget.checked) p.set('tests', '1');
					else p.delete('tests');
					location.search = p.toString();
				}}
			/>
			Include test sessions
		</label>
	</header>

	{#if data.pid && !d}
		<p class="warn">No session found for <b>{data.pid}</b>. <a href={qs({})}>Back to all participants</a></p>
	{:else if d}
		<!-- ================= participant detail ================= -->
		<p><a href={qs({})}>← All participants</a></p>
		<section class="hero">
			<div>
				<h2>{d.session.pid} {#if d.session.pid.startsWith('TEST-')}<span class="tag">test</span>{/if}</h2>
				<p class="muted">
					Condition <b>{d.session.condition}</b> · Board A <b>{d.session.board_a_theme}</b> · Board B <b>{d.session.board_b_theme}</b>
				</p>
				<p class="muted">
					Started {dateTime(d.session.created_at)} ·
					{#if d.session.completed_at}completed {dateTime(d.session.completed_at)}{:else}<span class="live">now in {PHASE_LABEL[d.session.phase] ?? d.session.phase}</span>{/if}
				</p>
			</div>
			<div class="tiles">
				<div class="tile"><span>Board A</span><b>{boardCell(s, 'A')}</b></div>
				<div class="tile"><span>Board B</span><b>{boardCell(s, 'B')}</b></div>
				<div class="tile"><span>Memory acc.</span><b>{pct(s.memory_acc)}</b></div>
				<div class="tile"><span>Level 2 acc.</span><b>{pct(s.level2_acc)}</b></div>
				<div class="tile"><span>SA env acc.</span><b>{pct(s.sa_env_acc)}</b></div>
				<div class="tile"><span>Objects d′</span><b>{num(s.q_objects_dprime, 2)}</b></div>
			</div>
		</section>

		<h3>Timeline</h3>
		<table class="timeline">
			<thead><tr><th>Phase</th><th>Started</th><th>Duration</th><th>Events</th></tr></thead>
			<tbody>
				{#each timeline as p (p.started_at + p.phase)}
					<tr>
						<td>{PHASE_LABEL[p.phase] ?? p.phase}</td>
						<td>{clock(p.started_at)}</td>
						<td>{p.ended_at ? secs(p.ended_at - p.started_at) : p.phase === 'done' ? '' : 'in progress'}</td>
						<td class="markers">
							{#each p.markers as m, i (i)}
								<span class="marker" class:alert={m.name === 'timeout' || m.name === 'resume'}>{m.name} +{(m.offset / 1000).toFixed(1)} s</span>
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<h3>Boards</h3>
		{#if !boards.length}<p class="muted">No board data.</p>{/if}
		<div class="boards">
			{#each boards as b (b.key)}
				<section class="boardcard">
					<h4>
						Board {b.key} · {b.theme}
						{#if b.timedOut}<span class="pill bad">time up</span>{:else if s[`${b.key}_cleared`]}<span class="pill good">cleared</span>{/if}
					</h4>
					<div class="grid" style:--cols={b.layout.cols}>
						{#each b.cells as c, i (i)}
							<div class="cell" class:unmatched={b.played && !c.match} style:--heat={c.heat} title="{c.label}: flipped {c.flips}×{c.match ? `, matched #${c.match}` : ', not matched'}">
								{#if c.spec}<ObjectImage spec={c.spec} size="60%" />{/if}
								<span class="flips">{c.flips}×</span>
								{#if c.match}<span class="order">#{c.match}</span>{/if}
							</div>
						{/each}
					</div>
					<p class="legend muted">Number = times flipped (darker = more) · #n = order matched</p>
					<dl class="metrics">
						<div><dt>Time</dt><dd>{boardCell(s, b.key)}</dd></div>
						<div><dt>Flips</dt><dd>{int(s[`${b.key}_total_flips`])}</dd></div>
						<div><dt>Moves</dt><dd>{int(s[`${b.key}_moves`])}</dd></div>
						<div><dt>Mismatches</dt><dd>{int(s[`${b.key}_mismatches`])}</dd></div>
						<div><dt>Efficiency</dt><dd>{pct(s[`${b.key}_efficiency`])}</dd></div>
						<div><dt>Repeat errors</dt><dd>{int(s[`${b.key}_repeat_errors`])}</dd></div>
						<div><dt>Missed matches</dt><dd>{int(s[`${b.key}_missed_matches`])}</dd></div>
						<div><dt>Reloads</dt><dd class:alertc={s[`${b.key}_reloads`] > 0}>{int(s[`${b.key}_reloads`])}</dd></div>
					</dl>
					<details>
						<summary>Click log ({b.clicks.length})</summary>
						<table class="compact">
							<thead><tr><th>#</th><th>Time</th><th>Card</th><th>Object</th><th>Outcome</th></tr></thead>
							<tbody>
								{#each b.clicks as c (c.seq)}
									<tr class={c.outcome}>
										<td>{c.seq}</td><td>{c.t.toFixed(1)} s</td><td>{c.card_index}</td><td>{c.label}</td>
										<td>{c.outcome.replace('_', ' ')}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				</section>
			{/each}
		</div>

		<div class="two">
			<section>
				<h3>Exercise / rest check</h3>
				{#if !d.bouts.length}<p class="muted">No RPE recorded.</p>{:else}
					<table>
						<thead><tr><th>Bout</th><th>RPE</th><th>Peak HR</th><th>%HRmax</th></tr></thead>
						<tbody>
							{#each d.bouts as b (b.bout)}
								<tr>
									<td>{b.bout === 'interval1' ? '1 (before A)' : '2 (before B)'}</td>
									<td>{b.rpe}</td>
									<td>{b.peak_hr ?? dash}</td>
									<td>{b.peak_hr && hrMax ? pct(b.peak_hr / hrMax) : dash}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
			<section>
				<h3>Survey</h3>
				{#if !d.survey}<p class="muted">Not filled in yet.</p>{:else}
					<dl class="kv">
						<dt>Age</dt><dd>{d.survey.age}</dd>
						<dt>Exercise days / week</dt><dd>{d.survey.exercise_days}</dd>
						<dt>Fitness (1–5)</dt><dd>{d.survey.fitness}</dd>
						<dt>Hours slept</dt><dd>{d.survey.hours_slept}</dd>
						<dt>Caffeine today</dt><dd>{d.survey.caffeine}</dd>
						<dt>Difficulty seeing colors</dt><dd>{d.survey.color_vision}</dd>
					</dl>
				{/if}
			</section>
		</div>

		<h3>SA answers</h3>
		{#if !d.sa.length}<p class="muted">No answers yet.</p>{:else}
			<p class="chips">
				{#each saGroups as g (g.type)}<span class="chip">{g.type} <b>{pct(g.acc)}</b> <span class="muted">({g.n})</span></span>{/each}
			</p>
			{#each grids as g (g.board)}
				<details class="grid-q">
					<summary>
						Board {g.board} recognition grid: <b>{g.hits}/{g.seen}</b> seen objects picked, <b>{g.fas}/{g.foils}</b> foils picked
						<span class="muted">· {isNum(g.rt) ? `${(g.rt / 1000).toFixed(1)} s` : ''}</span>
					</summary>
					<table class="compact">
						<thead><tr><th>Item</th><th>Was it on the board?</th><th>Picked</th><th></th></tr></thead>
						<tbody>
							{#each g.rows as r, i (i)}
								<tr>
									<td>{r.item}</td><td>{r.target === 'seen' ? 'yes' : 'no (foil)'}</td><td>{r.response === 'selected' ? 'yes' : 'no'}</td>
									<td class={r.correct ? 'ok' : 'no'}>{r.correct ? '✓' : '✗'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</details>
			{/each}
			<table class="compact">
				<thead><tr><th>#</th><th>Board</th><th>Type</th><th>Item</th><th>Correct answer</th><th>Response</th><th></th><th>Conf.</th><th>RT</th></tr></thead>
				<tbody>
					{#each singles as r, i (i)}
						{@const unset = r.question_type === 'oral' && r.target === ''}
						<tr>
							<td>{r.seq}</td><td>{r.board}</td><td>{r.question_type}</td><td>{r.item}</td><td>{unset ? 'not set' : r.target}</td>
							<td>{RESPONSE_LABEL[r.response] ?? r.response}</td>
							<td class={r.response === 'color_blind' || unset ? 'muted' : r.correct ? 'ok' : 'no'}>
								{r.response === 'color_blind' ? 'excl.' : unset ? '—' : r.correct ? '✓' : '✗'}
							</td>
							<td>{r.confidence ?? ''}</td><td>{isNum(r.rt_ms) ? `${(r.rt_ms / 1000).toFixed(1)} s` : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else}
		<!-- ================= overview ================= -->
		<div class="tiles wide">
			<div class="tile"><span>Participants</span><b>{rows.length}</b></div>
			<div class="tile"><span>Completed</span><b>{completed}</b></div>
			<div class="tile"><span>Boards timed out</span><b>{timeouts} <small>/ {boardsPlayed}</small></b></div>
			<div class="tile"><span>Time limit</span><b>{data.timeLimitS ? `${data.timeLimitS} s` : 'none'}</b></div>
		</div>
		{#if !rows.length}
			<p class="muted">
				No {data.includeTests ? '' : 'real '}sessions yet.{#if !data.includeTests} Tick “Include test sessions” to see test runs.{/if}
			</p>
		{:else}
			<h3>By condition <span class="muted small">(means)</span></h3>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>Condition</th><th>n</th><th>Done</th><th>A time</th><th>B time</th><th>A errors</th><th>B errors</th>
							<th>Timeouts</th><th>Memory</th><th>Level 2</th><th>SA env</th><th>d′</th><th>RPE 1</th><th>RPE 2</th><th>HR 1</th><th>HR 2</th>
						</tr>
					</thead>
					<tbody>
						{#each byCondition as c (c.condition)}
							<tr>
								<td><b>{c.condition}</b></td><td>{c.n}</td><td>{c.completed}</td>
								<td>{secs(c.A_time)}</td><td>{secs(c.B_time)}</td><td>{num(c.A_mis)}</td><td>{num(c.B_mis)}</td>
								<td>{c.timeouts}</td><td>{pct(c.memory)}</td><td>{pct(c.level2)}</td><td>{pct(c.env)}</td><td>{num(c.dprime, 2)}</td>
								<td>{num(c.rpe1)}</td><td>{num(c.rpe2)}</td><td>{num(c.hr1, 0)}</td><td>{num(c.hr2, 0)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">Board times average cleared boards only; timed-out boards are counted under Timeouts.</p>

			<h3>Participants <span class="muted small">(click a row for details, a header to sort)</span></h3>
			<div class="scroll">
				<table class="participants">
					<thead>
						<tr>
							{#each COLS as c (c.key)}
								<th title={c.title} onclick={() => sortBy(c.key)} class:sorted={sortKey === c.key}>
									{c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▴' : ' ▾') : ''}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sorted as r (r.pid)}
							<tr onclick={() => (location.href = qs({ pid: r.pid }))}>
								{#each COLS as c (c.key)}
									<td class:alertc={(c.key === 'A_time' && r.A_timed_out) || (c.key === 'B_time' && r.B_timed_out)}>
										{#if c.key === 'pid'}<a href={qs({ pid: r.pid })}>{r.pid}</a>{#if r.pid.startsWith('TEST-')} <span class="tag">test</span>{/if}{:else}{c.show(r)}{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">For the full set of columns, download <a href="/admin/export/summary.csv" download>summary.csv</a> (test sessions excluded).</p>
		{/if}
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
		max-width: 76rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
		border-bottom: 1px solid #ddd;
		padding-bottom: 0.6rem;
	}
	h1 {
		margin: 0.2rem 0 0;
	}
	h2 {
		margin: 0 0 0.3rem;
		font-size: 1.8rem;
	}
	h3 {
		margin: 1.8rem 0 0.6rem;
	}
	h4 {
		margin: 0 0 0.6rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	a {
		color: #1f63d6;
	}
	.back {
		font-size: 0.9rem;
	}
	.toggle {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.muted {
		color: #777;
	}
	.small {
		font-size: 0.85rem;
		font-weight: normal;
	}
	.warn {
		background: #fff4cc;
		padding: 0.5rem 1rem;
		border-radius: 6px;
	}
	.live {
		color: #1f63d6;
		font-weight: 600;
	}
	.tag {
		background: #efe3fb;
		color: #7b2cbf;
		font-size: 0.7rem;
		padding: 0 0.3rem;
		border-radius: 3px;
		vertical-align: middle;
	}
	.hero {
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	.hero p {
		margin: 0.2rem 0;
	}
	.tiles {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.tiles.wide {
		margin-top: 1.2rem;
	}
	.tile {
		border: 1px solid #d6e0f5;
		background: #f5f8ff;
		border-radius: 10px;
		padding: 0.5rem 0.9rem;
		min-width: 7.5rem;
		display: flex;
		flex-direction: column;
	}
	.tile span {
		font-size: 0.8rem;
		color: #556;
	}
	.tile b {
		font-size: 1.3rem;
		font-variant-numeric: tabular-nums;
	}
	.tile small {
		font-size: 0.85rem;
		color: #777;
		font-weight: normal;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		border-bottom: 1px solid #e3e3e3;
		padding: 0.35rem 0.55rem;
		text-align: left;
		white-space: nowrap;
	}
	th {
		background: #fafafa;
		font-weight: 600;
	}
	.participants th {
		cursor: pointer;
		user-select: none;
	}
	.participants th.sorted {
		color: #1f63d6;
	}
	.participants tbody tr {
		cursor: pointer;
	}
	.participants tbody tr:hover {
		background: #f2f6ff;
	}
	.alertc {
		color: #b06000;
		font-weight: 600;
	}
	.timeline .markers {
		white-space: normal;
	}
	.marker {
		display: inline-block;
		background: #eef1f6;
		border-radius: 4px;
		padding: 0 0.35rem;
		margin: 0.1rem 0.25rem 0.1rem 0;
		font-size: 0.8rem;
	}
	.marker.alert {
		background: #fde8d4;
		color: #8a4300;
	}
	.boards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
		gap: 1rem;
	}
	.boardcard {
		border: 1px solid #ddd;
		border-radius: 12px;
		padding: 1rem;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
	}
	.pill.good {
		background: #e2f5e7;
		color: #1d7a34;
	}
	.pill.bad {
		background: #fde8d4;
		color: #8a4300;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 0.35rem;
		max-width: 22rem;
	}
	.cell {
		position: relative;
		aspect-ratio: 1;
		border-radius: 8px;
		border: 1px solid #ccd;
		background: color-mix(in srgb, #ff8a3d calc(var(--heat) * 55%), #fafafa);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.cell.unmatched {
		border: 2px dashed #b06000;
	}
	.flips,
	.order {
		position: absolute;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
		padding: 0.1rem 0.2rem;
		border-radius: 3px;
		background: rgb(255 255 255 / 0.85);
	}
	.flips {
		top: 0.15rem;
		left: 0.15rem;
	}
	.order {
		bottom: 0.15rem;
		right: 0.15rem;
		color: #1f63d6;
	}
	.legend {
		font-size: 0.75rem;
		margin: 0.4rem 0 0.6rem;
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.4rem 0.8rem;
		margin: 0 0 0.6rem;
	}
	.metrics dt {
		font-size: 0.75rem;
		color: #667;
	}
	.metrics dd {
		margin: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	details summary {
		cursor: pointer;
		color: #1f63d6;
		margin-bottom: 0.4rem;
	}
	.compact td,
	.compact th {
		padding: 0.2rem 0.45rem;
		font-size: 0.82rem;
	}
	tr.match td:last-child {
		color: #1d7a34;
		font-weight: 600;
	}
	tr.mismatch td:last-child {
		color: #b03030;
	}
	.grid-q {
		margin: 0.4rem 0 0.8rem;
	}
	.grid-q table {
		max-width: 32rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1.5rem;
	}
	.kv {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
	}
	.kv dt {
		color: #667;
	}
	.kv dd {
		margin: 0;
		font-weight: 600;
	}
	.chips {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.chip {
		background: #eef1f6;
		border-radius: 999px;
		padding: 0.15rem 0.7rem;
		font-size: 0.85rem;
	}
	td.ok {
		color: #1d7a34;
		font-weight: 700;
	}
	td.no {
		color: #b03030;
		font-weight: 700;
	}
	@media (max-width: 40rem) {
		main {
			padding: 1rem;
		}
		.metrics {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>

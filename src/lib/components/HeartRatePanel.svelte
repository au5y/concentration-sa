<script lang="ts">
	import { onMount } from 'svelte';
	import { StrapManager, type Strap } from '$lib/client/hr-straps.svelte';

	/**
	 * Admin panel: connect Bluetooth heart-rate straps, assign each to a participant, and watch
	 * the live heart rate. Readings go to the server every 2 s (see hr-straps.svelte.ts).
	 */
	let {
		pids,
		heard,
		now
	}: {
		/** Participants a strap can be assigned to (sessions in progress). */
		pids: string[];
		/** Straps the server heard from in the last minute (from any admin tab). */
		heard: { strap: string; strap_name: string | null; pid: string | null; bpm: number; contact: number | null; ts: number }[];
		now: number;
	} = $props();

	const mgr = new StrapManager();
	let unsupported = $state('');
	let error = $state('');
	let tick = $state(Date.now());

	onMount(() => {
		unsupported = StrapManager.unsupported();
		mgr.start();
		const t = setInterval(() => (tick = Date.now()), 1000);
		// Reloading or closing this tab drops the straps.
		const warn = (e: BeforeUnloadEvent) => {
			if (mgr.connected) e.preventDefault();
		};
		addEventListener('beforeunload', warn);
		return () => {
			clearInterval(t);
			removeEventListener('beforeunload', warn);
			mgr.stop();
		};
	});

	async function add() {
		error = '';
		try {
			await mgr.add();
		} catch (e) {
			const err = e as Error;
			// Closing the picker without choosing is not an error.
			if (err.name !== 'NotFoundError') error = err.message;
		}
	}

	const age = (t: number | null) => (t ? Math.max(0, Math.round((tick - t) / 1000)) : null);
	const stale = (s: Strap) => s.status === 'live' && (age(s.lastAt) ?? 99) > 5;

	function spark(h: number[]): string {
		if (h.length < 2) return '';
		const lo = Math.min(...h) - 2;
		const hi = Math.max(...h) + 2;
		return h.map((v, i) => `${((i / (h.length - 1)) * 100).toFixed(1)},${(30 - ((v - lo) / (hi - lo)) * 30).toFixed(1)}`).join(' ');
	}

	const mine = $derived(new Set(mgr.straps.map((s) => s.id)));
	const others = $derived(heard.filter((h) => !mine.has(h.strap)));
	const options = (s: Strap) => [...new Set([...pids, ...(s.pid ? [s.pid] : [])])];
</script>

<section class="hr">
	<h2>Heart rate</h2>
	{#if unsupported}
		<p class="warn">{unsupported}</p>
	{:else}
		<p class="tools">
			<button class="primary" onclick={add}>+ Connect strap</button>
			<span class="muted small">
				Put the strap on (wet the electrodes), click, and pick it in the list. Keep this tab open: reloading it drops the straps.
			</span>
		</p>
	{/if}
	{#if error}<p class="err">{error}</p>{/if}

	{#if mgr.straps.length}
		<div class="straps">
			{#each mgr.straps as s (s.id)}
				<div class="strap" class:off={s.status !== 'live' || stale(s)} class:nocontact={s.contact === false}>
					<div class="top">
						<b>{s.name}</b>
						<span class="status">
							{#if s.status === 'live' && !stale(s)}● live
							{:else if s.status === 'live'}no reading for {age(s.lastAt)}s
							{:else}{s.status}…{/if}
						</span>
					</div>
					<div class="bpm">{s.bpm ?? '–'}<small> bpm</small></div>
					{#if s.contact === false}<div class="warnc">no skin contact: wet / tighten the strap</div>{/if}
					<svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true">
						<polyline points={spark(s.history)} />
					</svg>
					<label
						>Participant
						<select value={s.pid ?? ''} onchange={(e) => mgr.assign(s, e.currentTarget.value || null)}>
							<option value="">— unassigned —</option>
							{#each options(s) as p (p)}<option value={p}>{p}</option>{/each}
						</select>
					</label>
					{#if s.error && s.status !== 'live'}<div class="muted small">{s.error}</div>{/if}
					<div class="row">
						{#if s.status === 'disconnected'}
							<button class="small" onclick={() => mgr.resume(s)}>Reconnect</button>
						{:else}
							<button class="small" onclick={() => mgr.disconnect(s)}>Disconnect</button>
						{/if}
						<button class="small" onclick={() => mgr.remove(s)}>Remove</button>
					</div>
				</div>
			{/each}
		</div>
		<p class="muted small">
			{#if mgr.sendError}<span class="err">Not sending ({mgr.sendError}); {mgr.pending} readings kept and will be sent when the server is back.</span>
			{:else}Sent to server {mgr.lastSent ? `${age(mgr.lastSent)}s ago` : '—'}{mgr.pending ? ` · ${mgr.pending} waiting` : ''}.{/if}
			Readings are only saved under a participant once a strap is assigned.
		</p>
	{:else if mgr.pending}
		<p class="muted small">{mgr.pending} readings from an earlier visit are waiting to be sent.</p>
	{/if}

	{#if others.length}
		<p class="muted small">Connected on another computer or tab:</p>
		<ul class="others">
			{#each others as h (h.strap)}
				<li>{h.strap_name ?? h.strap}: <b>{h.bpm}</b> bpm{h.pid ? ` · ${h.pid}` : ' · unassigned'} <span class="muted">({Math.round((now - h.ts) / 1000)}s ago)</span></li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.hr {
		margin-bottom: 1.5rem;
	}
	.tools {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.primary {
		font-size: 1rem;
		padding: 0.4rem 1rem;
		border-radius: 6px;
		border: 2px solid #c0392b;
		background: #c0392b;
		color: white;
		font-weight: 600;
		cursor: pointer;
	}
	.straps {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 0.75rem;
	}
	.strap {
		border: 2px solid #2a9d3f;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.strap.off {
		border-color: #e0a800;
	}
	.strap.nocontact {
		border-color: #c0392b;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.status {
		color: #2a9d3f;
		white-space: nowrap;
	}
	.off .status {
		color: #b07d00;
	}
	.bpm {
		font-size: 2.6rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: #c0392b;
		line-height: 1;
	}
	.bpm small {
		font-size: 1rem;
		color: #777;
		font-weight: 600;
	}
	.spark {
		width: 100%;
		height: 2.2rem;
	}
	.spark polyline {
		fill: none;
		stroke: #c0392b;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	label {
		font-size: 0.9rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.small {
		font-size: 0.85rem;
	}
	.muted {
		color: #666;
	}
	.warn,
	.warnc {
		color: #b07d00;
	}
	.warnc {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.err {
		color: #c0392b;
	}
	.others {
		margin: 0.2rem 0;
		font-size: 0.9rem;
	}
</style>

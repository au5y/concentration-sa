<script lang="ts">
	import { onMount } from 'svelte';
	import { StrapManager } from '$lib/client/hr-straps.svelte';

	/**
	 * A remote participant's own heart-rate strap, connected in their browser (Chrome/Edge Web
	 * Bluetooth). Readings are saved under their pid and show up live on the facilitator's console.
	 * The run page owns `mgr` (so the strap stays connected across phases); `big` shows the full
	 * instructions (sensor-fit screen), otherwise a small badge in the corner.
	 */
	let { mgr, big = false }: { mgr: StrapManager; big?: boolean } = $props();

	let unsupported = $state('');
	let error = $state('');
	let tick = $state(Date.now());

	onMount(() => {
		unsupported = StrapManager.unsupported();
		const t = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(t);
	});

	async function connect() {
		error = '';
		try {
			await mgr.add();
		} catch (e) {
			const err = e as Error;
			if (err.name !== 'NotFoundError') error = err.message;
		}
	}

	const strap = $derived(mgr.straps.find((s) => s.status !== 'disconnected') ?? mgr.straps[0] ?? null);
	const live = $derived(!!strap && strap.status === 'live' && !!strap.lastAt && tick - strap.lastAt < 6000);
</script>

{#if big}
	<div class="big">
		{#if unsupported}
			<p class="warn">{unsupported} Tell your facilitator.</p>
		{:else if live && strap}
			<p class="bpm">♥ {strap.bpm}<small> bpm</small></p>
			<p class="ok">Heart-rate strap connected ({strap.name}).</p>
			{#if strap.contact === false}<p class="warn">No skin contact: wet the electrodes and tighten the strap.</p>{/if}
		{:else if strap}
			<p class="warn">{strap.status === 'disconnected' ? 'Strap disconnected.' : 'Connecting to the strap…'}</p>
			{#if strap.status === 'disconnected'}<button class="connect" onclick={() => mgr.resume(strap!)}>Reconnect</button>{/if}
		{:else}
			<ol>
				<li>Wet the strap's electrodes and put it on around your chest.</li>
				<li>Click the button and pick your strap in the list that pops up.</li>
			</ol>
			<button class="connect" onclick={connect}>Connect heart-rate strap</button>
		{/if}
		{#if error}<p class="warn">{error}</p>{/if}
		{#if mgr.sendError}<p class="warn small">Not reaching the server ({mgr.sendError}); readings are kept and sent when it's back.</p>{/if}
	</div>
{:else if !unsupported}
	<div class="badge" class:off={!live}>
		{#if live && strap}♥ {strap.bpm}
		{:else if strap && strap.status !== 'disconnected'}♥ …
		{:else}<button onclick={strap ? () => mgr.resume(strap!) : connect}>♥ {strap ? 'Reconnect strap' : 'Connect strap'}</button>{/if}
	</div>
{/if}

<style>
	.big {
		margin: 1.5rem auto;
		padding: 1rem 1.5rem;
		border: 2px solid #c0392b;
		border-radius: 14px;
		max-width: 30rem;
		text-align: left;
	}
	.big ol {
		font-size: 1.1rem;
		padding-left: 1.3rem;
	}
	.connect {
		display: block;
		margin: 0.8rem auto 0;
		font-size: 1.4rem;
		font-weight: 700;
		padding: 0.7rem 1.8rem;
		border-radius: 10px;
		border: none;
		background: #c0392b;
		color: white;
		cursor: pointer;
	}
	.bpm {
		font-size: 3rem;
		font-weight: 800;
		color: #c0392b;
		text-align: center;
		margin: 0;
	}
	.bpm small {
		font-size: 1rem;
		color: #777;
	}
	.ok {
		color: #2a9d3f;
		text-align: center;
		font-weight: 600;
	}
	.warn {
		color: #b06000;
		font-weight: 600;
	}
	.small {
		font-size: 0.85rem;
	}
	.badge {
		position: fixed;
		left: 0.5rem;
		bottom: 0.5rem;
		z-index: 15;
		font: 700 0.9rem system-ui, sans-serif;
		color: #c0392b;
		background: rgb(255 255 255 / 0.9);
		border: 1px solid #e6b8b2;
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
	}
	.badge.off {
		color: #b06000;
		border-color: #e0a800;
	}
	.badge button {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
</style>

<script lang="ts">
	import LandingView from '$lib/components/LandingView.svelte';

	/** Public front page: what the study is and where to sign up (edited on the admin page). */
	let { data } = $props();
</script>

<svelte:head>
	<title>Pump Up the Memory: HSE Study</title>
	<meta name="description" content="{data.landing.kicker}: {data.landing.title} {data.landing.titleAccent}. {data.landing.date}" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<LandingView landing={data.landing} />


<style>
	:global(body) {
		margin: 0;
		background: #fff;
	}
</style>

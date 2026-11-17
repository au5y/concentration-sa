<script lang="ts">
	import LandingView from '$lib/components/LandingView.svelte';

	/** Public front page: what the study is and where to sign up (edited on the admin page). */
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.landing.title}</title>
	<meta name="description" content="Sign up for {data.landing.title}" />
</svelte:head>

<LandingView landing={data.landing} />

<p class="team"><a href="/run">Study team</a></p>

<style>
	:global(body) {
		margin: 0;
		background: #fff;
	}
	.team {
		text-align: center;
		font: 0.8rem system-ui, sans-serif;
		margin: 0 0 1.5rem;
	}
	.team a {
		color: #999;
	}
</style>

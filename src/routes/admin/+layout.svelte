<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Dark mode for the facilitator pages only (/admin, /admin/explore); the study itself stays
	 * light. The page is inverted with a CSS filter and pictures are inverted back, so object
	 * colors and photos keep their true colors. The choice is remembered in this browser.
	 */
	let { children } = $props();
	const KEY = 'admin-theme';
	let dark = $state(false);

	function apply() {
		if (dark) document.documentElement.dataset.adminTheme = 'dark';
		else delete document.documentElement.dataset.adminTheme;
	}

	onMount(() => {
		try {
			dark = localStorage.getItem(KEY) === 'dark';
		} catch {
			// storage blocked: start light
		}
		apply();
		return () => delete document.documentElement.dataset.adminTheme;
	});

	function toggle() {
		dark = !dark;
		apply();
		try {
			localStorage.setItem(KEY, dark ? 'dark' : 'light');
		} catch {
			// not remembered; fine
		}
	}
</script>

<button class="theme" onclick={toggle} title="Toggle dark mode (facilitator pages only)" aria-pressed={dark}>
	{dark ? '☀ Light' : '☾ Dark'}
</button>

{@render children()}

<style>
	:global(html[data-admin-theme='dark']) {
		background: #fff;
		filter: invert(1) hue-rotate(180deg);
	}
	/* Pictures and object icons keep their real colors. */
	:global(html[data-admin-theme='dark'] :is(img, video, .obj, .emoji)) {
		filter: invert(1) hue-rotate(180deg);
	}
	.theme {
		position: fixed;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 50;
		font: 600 0.85rem system-ui, sans-serif;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		border: 1px solid #bbb;
		background: #f4f4f4;
		color: #222;
		cursor: pointer;
	}
</style>

<script lang="ts">
	import type { RenderSpec } from '$lib/render';

	let { spec, size = '100%' }: { spec: RenderSpec; size?: string } = $props();
</script>

{#if spec.emoji}
	<div class="emoji" style:width={size} style:height={size}><span>{spec.emoji}</span></div>
{:else if spec.original}
	<div class="orig" style:width={size} style:height={size} style:transform={spec.transform}>
		<img src={spec.src} alt="" draggable="false" />
	</div>
{:else}
	<div
		class="obj"
		style:width={size}
		style:height={size}
		style:background-color={spec.hex}
		style:mask-image="url({spec.src})"
		style:-webkit-mask-image="url({spec.src})"
		style:transform={spec.transform}
	></div>
{/if}

<style>
	.obj {
		mask-size: contain;
		mask-repeat: no-repeat;
		mask-position: center;
		-webkit-mask-size: contain;
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
	}
	.orig img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		pointer-events: none;
	}
	.emoji {
		container-type: size;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		user-select: none;
	}
	.emoji span {
		font-size: 70cqmin;
	}
</style>

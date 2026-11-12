import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// Allow Tailscale MagicDNS names (e.g. dev-box.<tailnet>.ts.net) in dev/preview.
	server: { allowedHosts: ['.ts.net'] },
	preview: { allowedHosts: ['.ts.net'] },
	test: {
		include: ['tests/**/*.test.ts']
	}
});

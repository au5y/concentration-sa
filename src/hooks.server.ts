import type { Handle } from '@sveltejs/kit';
import { canRun, isRunGated } from '$lib/server/access';
import { remotePid } from '$lib/server/remote';

/**
 * Session data and game images only for logged-in study laptops (see access.ts) or a remote
 * participant's browser (see remote.ts; each session endpoint then checks it is their own pid).
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (isRunGated(event.url.pathname) && !canRun(event.cookies) && !remotePid(event.cookies)) {
		return new Response(JSON.stringify({ message: 'Not logged in: open /run and enter the study password, or use your participant link' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}
	return resolve(event);
};

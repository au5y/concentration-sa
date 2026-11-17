import type { Handle } from '@sveltejs/kit';
import { canRun, isRunGated } from '$lib/server/access';

/** Session data and game images only for logged-in study laptops (see access.ts). */
export const handle: Handle = async ({ event, resolve }) => {
	if (isRunGated(event.url.pathname) && !canRun(event.cookies)) {
		return new Response(JSON.stringify({ message: 'Not logged in: open /run and enter the study password' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}
	return resolve(event);
};

import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body, checkPid } from '$lib/server/http';
import { consoleAction } from '$lib/server/remote-console';

/** { action: 'advance' | 'start' | 'bout', phase, rpe?, peak_hr? } from the facilitator console. */
export async function POST({ request, cookies, params }) {
	requireAdmin(cookies);
	const b = await body(request);
	consoleAction(checkPid(params.pid), b);
	return json({ ok: true });
}

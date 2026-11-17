import { json } from '@sveltejs/kit';
import { body } from '$lib/server/http';
import { recordHr } from '$lib/server/hr';
import { sessionPid } from '$lib/server/remote';

/** Heart-rate readings from a remote participant's own strap: { pid, samples, client_now }. Stored under that pid. */
export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	return json(recordHr(b.samples, b.client_now, pid));
}

import { error, json } from '@sveltejs/kit';
import { sessionPid } from '$lib/server/remote';
import { PHASES, type Phase } from '$lib/types';
import { body, clientTs } from '$lib/server/http';
import { mark } from '$lib/server/session';

export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	if (!PHASES.includes(b.phase)) error(400, 'bad phase');
	const at = mark(pid, b.phase as Phase, String(b.name), clientTs(b.client_ts));
	return json({ at });
}

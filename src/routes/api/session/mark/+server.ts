import { error, json } from '@sveltejs/kit';
import { PHASES, type Phase } from '$lib/types';
import { body, checkPid, clientTs } from '$lib/server/http';
import { mark } from '$lib/server/session';

export async function POST({ request }) {
	const b = await body(request);
	const pid = checkPid(b.pid);
	if (!PHASES.includes(b.phase)) error(400, 'bad phase');
	const at = mark(pid, b.phase as Phase, String(b.name), clientTs(b.client_ts));
	return json({ at });
}

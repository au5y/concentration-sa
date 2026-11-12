import { error, json } from '@sveltejs/kit';
import { PHASES, type Phase } from '$lib/types';
import { body, checkPid, clientTs } from '$lib/server/http';
import { advance, buildState } from '$lib/server/session';

export async function POST({ request }) {
	const b = await body(request);
	const pid = checkPid(b.pid);
	if (!PHASES.includes(b.from)) error(400, 'bad phase');
	const s = advance(pid, b.from as Phase, { facilitator: b.facilitator === true, clientTs: clientTs(b.client_ts) });
	return json(buildState(s));
}

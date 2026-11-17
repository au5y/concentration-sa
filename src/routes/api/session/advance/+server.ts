import { error, json } from '@sveltejs/kit';
import { canRun } from '$lib/server/access';
import { sessionPid } from '$lib/server/remote';
import { PHASES, type Phase } from '$lib/types';
import { body, clientTs } from '$lib/server/http';
import { advance, buildState } from '$lib/server/session';

export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	if (!PHASES.includes(b.from)) error(400, 'bad phase');
	const s = advance(pid, b.from as Phase, { facilitator: b.facilitator === true && canRun(cookies), clientTs: clientTs(b.client_ts) });
	return json(buildState(s));
}

import { error, json } from '@sveltejs/kit';
import { canRun } from '$lib/server/access';
import { body } from '$lib/server/http';
import { remoteKey } from '$lib/server/remote';
import { addToSchedule } from '$lib/server/schedule';

/** New participant from the study start page: { remote } -> { pid, key? }. One balanced schedule row. */
export async function POST({ request, cookies }) {
	if (!canRun(cookies)) error(403, 'Log in with the study password first');
	const b = await body(request);
	const remote = b.remote === true;
	const [pid] = addToSchedule(1, remote);
	return json({ pid, ...(remote ? { key: remoteKey(pid) } : {}) });
}

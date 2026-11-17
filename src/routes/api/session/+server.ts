import { error, json } from '@sveltejs/kit';
import { sessionPid } from '$lib/server/remote';
import { buildState, getSession, openSession } from '$lib/server/session';

/** Open (or resume) a session. ?poll=1 only reads it, for remote sessions watching for the facilitator's moves. */
export function GET({ url, cookies }) {
	const pid = sessionPid(cookies, url.searchParams.get('pid'));
	if (url.searchParams.get('poll') === '1') {
		const s = getSession(pid);
		if (!s) error(404, `No session for ${pid}`);
		return json(buildState(s));
	}
	return json(buildState(openSession(pid)));
}

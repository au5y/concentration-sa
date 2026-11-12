import { json } from '@sveltejs/kit';
import { checkPid } from '$lib/server/http';
import { buildState, openSession } from '$lib/server/session';

export function GET({ url }) {
	return json(buildState(openSession(checkPid(url.searchParams.get('pid')))));
}

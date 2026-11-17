import { redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';
import { checkPid } from '$lib/server/http';
import { isRemotePid, remoteKey } from '$lib/server/remote';
import { consoleState } from '$lib/server/remote-console';

export function load({ cookies, params }) {
	if (!isAdmin(cookies)) redirect(303, '/admin');
	const pid = checkPid(params.pid);
	return { pid, key: isRemotePid(pid) ? remoteKey(pid) : null, s: consoleState(pid) };
}

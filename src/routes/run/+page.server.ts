import { canRun } from '$lib/server/access';
import { remoteLogin, remotePid } from '$lib/server/remote';

/**
 * authed: this browser may open the requested session. A study laptop (password) may open any;
 * a remote participant's browser (link with ?key=, remembered in a cookie) only their own.
 */
export function load({ cookies, url }) {
	const pid = url.searchParams.get('pid');
	const key = url.searchParams.get('key');
	if (canRun(cookies)) return { authed: true, laptop: true };
	if (pid && key && remoteLogin(cookies, pid, key)) return { authed: true, laptop: false };
	const own = remotePid(cookies);
	return { authed: !!pid && own === pid, laptop: false, badLink: !!key };
}

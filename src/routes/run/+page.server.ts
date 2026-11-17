import { canRun } from '$lib/server/access';

export function load({ cookies }) {
	return { authed: canRun(cookies) };
}

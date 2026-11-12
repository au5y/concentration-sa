import { isAdmin } from '$lib/server/admin';
import { previewData } from '$lib/server/preview';

export function load({ cookies }) {
	if (!isAdmin(cookies)) return { authed: false as const };
	return { authed: true as const, ...previewData() };
}

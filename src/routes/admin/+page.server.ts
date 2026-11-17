import { adminEnabled, isAdmin, status } from '$lib/server/admin';
import { getLanding } from '$lib/server/landing';

export function load({ cookies }) {
	if (!isAdmin(cookies)) return { authed: false as const, enabled: adminEnabled() };
	return { authed: true as const, enabled: true, ...status(), landing: getLanding() };
}

import { adminEnabled, isAdmin, status } from '$lib/server/admin';
import { getLanding } from '$lib/server/landing';
import { getTagPresets } from '$lib/server/tag-presets';

export function load({ cookies }) {
	if (!isAdmin(cookies)) return { authed: false as const, enabled: adminEnabled() };
	return { authed: true as const, enabled: true, ...status(), landing: getLanding(), tagPresets: getTagPresets() };
}

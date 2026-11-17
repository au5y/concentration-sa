import { getLanding } from '$lib/server/landing';

export function load() {
	return { landing: getLanding() };
}

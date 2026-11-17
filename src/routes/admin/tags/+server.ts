import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body } from '$lib/server/http';
import { saveTagPresets } from '$lib/server/tag-presets';

/** Save the suggested tags: { tags: string[] }. */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	if (!Array.isArray(b.tags)) error(400, 'tags must be a list');
	return json({ tags: saveTagPresets(b.tags) });
}

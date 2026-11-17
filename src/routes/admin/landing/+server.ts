import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body } from '$lib/server/http';
import { saveLanding } from '$lib/server/landing';

/** Save the public front page: { title, body, links: [{ label, url }], closed, contact }. */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	return json(saveLanding(await body(request)));
}

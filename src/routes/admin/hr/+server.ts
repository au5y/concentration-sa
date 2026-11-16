import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body } from '$lib/server/http';
import { recordHr } from '$lib/server/hr';

/** Heart-rate strap readings from the admin page: { samples: HrSample[], client_now }. */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	return json(recordHr(b.samples, b.client_now));
}

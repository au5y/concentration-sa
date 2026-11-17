import { error, json } from '@sveltejs/kit';
import { runLogin, runLogout } from '$lib/server/access';
import { body } from '$lib/server/http';

export async function POST({ request, cookies }) {
	const b = await body(request);
	if (!runLogin(cookies, String(b.password ?? ''))) error(401, 'Wrong password');
	return json({ ok: true });
}

export function DELETE({ cookies }) {
	runLogout(cookies);
	return json({ ok: true });
}

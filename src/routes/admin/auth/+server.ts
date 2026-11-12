import { error, json } from '@sveltejs/kit';
import { login, logout } from '$lib/server/admin';
import { body } from '$lib/server/http';

// JSON rather than a form action: SvelteKit's form CSRF check compares against an
// https origin under adapter-node unless ORIGIN is set, which breaks plain-HTTP LAN use.
export async function POST({ request, cookies }) {
	const b = await body(request);
	if (!login(cookies, String(b.password ?? ''))) error(401, 'Wrong password');
	return json({ ok: true });
}

export function DELETE({ cookies }) {
	logout(cookies);
	return json({ ok: true });
}

import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body, checkPid } from '$lib/server/http';
import { deleteParticipants, resetAllData } from '$lib/server/session';

/** Test-data cleanup: { action: 'delete', pids: [...] } or { action: 'reset', confirm: 'RESET' }. */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	if (b.action === 'delete') {
		if (!Array.isArray(b.pids) || !b.pids.length) error(400, 'pids required');
		return json({ deleted: deleteParticipants(b.pids.map(checkPid)) });
	}
	if (b.action === 'reset') {
		if (b.confirm !== 'RESET') error(400, 'confirm must be "RESET"');
		resetAllData();
		return json({ ok: true });
	}
	error(400, 'unknown action');
}

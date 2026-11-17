import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body, checkPid } from '$lib/server/http';
import { editParticipant } from '$lib/server/edit';
import { archiveParticipant, deleteParticipants, resetAllData } from '$lib/server/session';

/**
 * { action: 'archive', pid, tag } (keep the data, out of the normal exports),
 * { action: 'edit', pid, changes: { pid?, condition?, tags?, survey?, bouts? } } (corrections, logged in edits),
 * { action: 'delete', pids: [...] } or { action: 'reset', confirm: 'RESET' }.
 */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	if (b.action === 'archive') {
		if (typeof b.tag !== 'string') error(400, 'tag required');
		return json({ archived: archiveParticipant(checkPid(b.pid), b.tag) });
	}
	if (b.action === 'edit') {
		if (!b.changes || typeof b.changes !== 'object') error(400, 'changes required');
		return json(editParticipant(checkPid(b.pid), b.changes));
	}
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

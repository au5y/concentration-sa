import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body, checkPid } from '$lib/server/http';
import { addToSchedule, removeFromSchedule, setScheduleRemote } from '$lib/server/schedule';

/**
 * { add: number, remote?: boolean } -> { added: string[] }  add balanced participants at the end
 * { action: 'remove', pids: [...] } -> { removed }            drop participants who haven't started
 * { action: 'remote', pid, remote: boolean }                 switch a not-yet-started participant
 */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	if (b.action === 'remove') {
		if (!Array.isArray(b.pids) || !b.pids.length) error(400, 'pids required');
		return json({ removed: removeFromSchedule(b.pids.map(checkPid)) });
	}
	if (b.action === 'remote') {
		setScheduleRemote(checkPid(b.pid), b.remote === true);
		return json({ ok: true });
	}
	return json({ added: addToSchedule(Number(b.add), b.remote === true) });
}

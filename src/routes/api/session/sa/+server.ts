import { json } from '@sveltejs/kit';
import { body, checkPid, clientTs } from '$lib/server/http';
import { recordSa } from '$lib/server/session';

export async function POST({ request }) {
	const b = await body(request);
	const pid = checkPid(b.pid);
	const r = recordSa(pid, {
		seq: Number(b.seq),
		response: b.response,
		confidence: typeof b.confidence === 'number' ? b.confidence : null,
		rt_ms: Number(b.rt_ms),
		confidence_rt_ms: typeof b.confidence_rt_ms === 'number' ? b.confidence_rt_ms : null,
		submit_rt_ms: typeof b.submit_rt_ms === 'number' ? b.submit_rt_ms : null,
		answer_changes: Number.isInteger(b.answer_changes) ? b.answer_changes : 0,
		confidence_changes: Number.isInteger(b.confidence_changes) ? b.confidence_changes : 0,
		client_ts: clientTs(b.client_ts) ?? 0
	});
	return json(r);
}

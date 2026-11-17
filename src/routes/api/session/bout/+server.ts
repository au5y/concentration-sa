import { json } from '@sveltejs/kit';
import { sessionPid } from '$lib/server/remote';
import { body } from '$lib/server/http';
import { recordBout } from '$lib/server/session';
import type { Phase } from '$lib/types';

/** { pid, phase: 'interval1' | 'interval2', rpe: 6-20, peak_hr?: bpm } */
export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	recordBout(pid, { phase: b.phase as Phase, rpe: b.rpe, peak_hr: typeof b.peak_hr === 'number' ? b.peak_hr : null });
	return json({ ok: true });
}

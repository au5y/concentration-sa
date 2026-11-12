import { json } from '@sveltejs/kit';
import { body, checkPid } from '$lib/server/http';
import { recordBout } from '$lib/server/session';
import type { Phase } from '$lib/types';

/** { pid, phase: 'interval1' | 'interval2', rpe: 6-20, peak_hr?: bpm } */
export async function POST({ request }) {
	const b = await body(request);
	const pid = checkPid(b.pid);
	recordBout(pid, { phase: b.phase as Phase, rpe: b.rpe, peak_hr: typeof b.peak_hr === 'number' ? b.peak_hr : null });
	return json({ ok: true });
}

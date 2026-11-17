import { json } from '@sveltejs/kit';
import { sessionPid } from '$lib/server/remote';
import { body, clientTs } from '$lib/server/http';
import { buildState, recordSurvey } from '$lib/server/session';

export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	const s = recordSurvey(
		pid,
		{
			age: b.age,
			exercise_days: b.exercise_days,
			fitness: b.fitness,
			hours_slept: b.hours_slept
		},
		clientTs(b.client_ts)
	);
	return json(buildState(s));
}

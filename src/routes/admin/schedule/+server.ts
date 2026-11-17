import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { experiment } from '$lib/server/experiment';
import { loadSchedule, saveSchedule } from '$lib/server/files';
import { body } from '$lib/server/http';
import { extendSchedule } from '$lib/schedule';

/** Add participants to the end of the schedule: { add: number } -> { added: string[] }. */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	const add = Number(b.add);
	if (!Number.isInteger(add) || add < 1 || add > 100) error(400, 'add must be a whole number from 1 to 100');
	const existing = loadSchedule();
	if (!existing.length) error(400, 'There is no schedule yet. Generate one with "npm run schedule" first.');
	const { conditions, theme_orders } = experiment().config;
	const rows = extendSchedule(existing, { conditions, theme_orders, add });
	saveSchedule(rows);
	return json({ added: rows.slice(existing.length).map((r) => r.pid) });
}

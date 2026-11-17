/** Changes to schedule.csv from the admin page and the study start page. */
import { error } from '@sveltejs/kit';
import { extendSchedule } from '../schedule';
import { randomSeed } from '../rng';
import { getDb } from './db';
import { editParticipant } from './edit';
import { experiment } from './experiment';
import { loadSchedule, saveSchedule } from './files';

const sessionPids = () => new Set((getDb().prepare('SELECT pid FROM sessions').all() as { pid: string }[]).map((r) => r.pid));

/** Add `n` balanced participants to the end of the schedule (starting one if there is none). Returns their pids. */
export function addToSchedule(n: number, remote = false): string[] {
	if (!Number.isInteger(n) || n < 1 || n > 100) error(400, 'add must be a whole number from 1 to 100');
	const existing = loadSchedule();
	const { conditions, theme_orders } = experiment().config;
	const rows = extendSchedule(existing, { conditions, theme_orders, add: n, remote, taken: sessionPids(), seed: randomSeed() });
	saveSchedule(rows);
	return rows.slice(existing.length).map((r) => r.pid);
}

/** Remove participants who have not started yet. Returns the pids removed. */
export function removeFromSchedule(pids: string[]): string[] {
	const started = sessionPids();
	const bad = pids.filter((p) => started.has(p));
	if (bad.length) error(409, `${bad.join(', ')} already started; delete or archive their session instead`);
	const want = new Set(pids);
	const rows = loadSchedule();
	const keep = rows.filter((r) => !want.has(r.pid));
	saveSchedule(keep);
	return rows.filter((r) => want.has(r.pid)).map((r) => r.pid);
}

/** Switch a not-yet-started participant between remote (RP) and in person. */
export function setScheduleRemote(pid: string, remote: boolean): void {
	if (sessionPids().has(pid)) error(409, `${pid} already started; change the RP tag on the session instead`);
	const rows = loadSchedule();
	const r = rows.find((x) => x.pid === pid);
	if (!r) error(404, `${pid} is not in the schedule`);
	r.remote = remote;
	saveSchedule(rows);
}

/**
 * Switch a participant's condition (e.g. elevated_hr ↔ rest). Updates the schedule row and, if they
 * have started, the session (logged in the edits table). Board themes and order are unchanged.
 */
export function setCondition(pid: string, condition: string): void {
	if (!experiment().config.conditions.includes(condition)) error(400, `Unknown condition "${condition}"`);
	if (sessionPids().has(pid)) {
		editParticipant(pid, { condition }); // also updates the schedule row
		return;
	}
	const rows = loadSchedule();
	const r = rows.find((x) => x.pid === pid);
	if (!r) error(404, `${pid} is not in the schedule`);
	r.condition = condition;
	saveSchedule(rows);
}

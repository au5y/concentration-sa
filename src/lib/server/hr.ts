import { error } from '@sveltejs/kit';
import type { HrSample } from '../hr';
import { getDb } from './db';

const MAX_BATCH = 2000;
const PID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Store a batch of strap readings sent from the admin page. `clientNow` is the sender's clock at
 * upload time; the difference to the server clock moves every sample onto the server clock, so
 * they line up with the phase times. Re-sent samples (same strap and client time) are ignored.
 */
export function recordHr(samples: unknown, clientNow: unknown): { stored: number } {
	if (!Array.isArray(samples)) error(400, 'samples must be a list');
	if (samples.length > MAX_BATCH) error(400, `at most ${MAX_BATCH} samples per upload`);
	if (typeof clientNow !== 'number' || !Number.isFinite(clientNow)) error(400, 'client_now required');
	const offset = Date.now() - clientNow;
	const db = getDb();
	const insert = db.prepare(
		`INSERT OR IGNORE INTO hr_samples (pid, strap, strap_name, ts, client_ts, bpm, rr_ms, contact, server_ts)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const now = Date.now();
	return db.transaction(() => {
		let stored = 0;
		for (const raw of samples as Partial<HrSample>[]) {
			const s = raw ?? {};
			if (typeof s.strap !== 'string' || !s.strap || s.strap.length > 128) error(400, 'bad strap');
			if (s.pid !== null && s.pid !== undefined && (typeof s.pid !== 'string' || !PID.test(s.pid))) error(400, 'bad pid');
			if (typeof s.ts !== 'number' || !Number.isFinite(s.ts)) error(400, 'bad ts');
			if (!Number.isInteger(s.bpm) || s.bpm! < 0 || s.bpm! > 300) error(400, 'bad bpm');
			const rr = Array.isArray(s.rr) ? s.rr.filter((x) => Number.isFinite(x) && x > 0 && x < 5000).map(Math.round) : [];
			const contact = s.contact === true ? 1 : s.contact === false ? 0 : null;
			const name = typeof s.strap_name === 'string' ? s.strap_name.slice(0, 128) : null;
			stored += insert.run(s.pid ?? null, s.strap, name, Math.round(s.ts + offset), s.ts, s.bpm, rr.join(' '), contact, now).changes;
		}
		return { stored };
	})();
}


/**
 * Heart-rate straps over Bluetooth Low Energy: the standard Heart Rate Service (0x180D),
 * Heart Rate Measurement characteristic (0x2A37). Every strap that talks to phone apps
 * (Polar H10/H9, Garmin HRM-Dual, Wahoo TICKR, Coospo, ...) uses it.
 */

export const HR_SERVICE = 'heart_rate';
export const HR_MEASUREMENT = 'heart_rate_measurement';

export interface HrReading {
	bpm: number;
	/** Beat-to-beat (RR) intervals in ms, if the strap sends them (often none or several per message). */
	rr: number[];
	/** Skin contact: true / false if the strap reports it, null if it doesn't support contact detection. */
	contact: boolean | null;
}

/**
 * Parse one Heart Rate Measurement notification (Bluetooth GATT spec, 0x2A37):
 * flags byte; bit0 = 16-bit HR; bit1-2 = contact status (bit2 = supported, bit1 = detected);
 * bit3 = energy expended (uint16) present; bit4 = RR intervals present (uint16, 1/1024 s).
 */
export function parseHrMeasurement(v: DataView): HrReading {
	const flags = v.getUint8(0);
	let o = 1;
	let bpm: number;
	if (flags & 0x01) {
		bpm = v.getUint16(o, true);
		o += 2;
	} else {
		bpm = v.getUint8(o);
		o += 1;
	}
	const contact = flags & 0x04 ? (flags & 0x02) !== 0 : null;
	if (flags & 0x08) o += 2;
	const rr: number[] = [];
	if (flags & 0x10) {
		for (; o + 1 < v.byteLength; o += 2) rr.push(Math.round((v.getUint16(o, true) / 1024) * 1000));
	}
	return { bpm, rr, contact };
}

/** One stored sample, as sent to /admin/hr. `ts` is the facilitator computer's clock (epoch ms). */
export interface HrSample {
	strap: string;
	strap_name: string;
	pid: string | null;
	ts: number;
	bpm: number;
	rr: number[];
	contact: boolean | null;
}

export interface PhaseSpan {
	pid: string;
	phase: string;
	started_at: number;
	ended_at: number | null;
}

/** Phases summarized in the CSV (markers like board_a.play are skipped). */
export const HR_PHASES = ['survey', 'baseline', 'practice', 'interval1', 'board_a', 'interval2', 'board_b', 'break', 'sa'] as const;

/**
 * Mean and peak heart rate per phase for each participant, from samples on the server clock.
 * Samples without skin contact are ignored. Returns { pid: { hr_mean_<phase>, hr_peak_<phase>, hr_n_<phase> } }.
 */
export function hrByPhase(
	samples: { pid: string | null; ts: number; bpm: number; contact: number | null }[],
	phases: PhaseSpan[]
): Record<string, Record<string, number | null>> {
	const out: Record<string, Record<string, number | null>> = {};
	const byPid = new Map<string, { ts: number; bpm: number }[]>();
	for (const s of samples) {
		if (!s.pid || s.contact === 0 || !(s.bpm > 0)) continue;
		(byPid.get(s.pid) ?? byPid.set(s.pid, []).get(s.pid)!).push(s);
	}
	for (const [pid, list] of byPid) {
		const row: Record<string, number | null> = {};
		for (const ph of HR_PHASES) {
			const spans = phases.filter((p) => p.pid === pid && p.phase === ph);
			const inPhase = list.filter((s) => spans.some((p) => s.ts >= p.started_at && (p.ended_at === null || s.ts < p.ended_at)));
			row[`hr_mean_${ph}`] = inPhase.length ? Math.round((inPhase.reduce((a, s) => a + s.bpm, 0) / inPhase.length) * 10) / 10 : null;
			row[`hr_peak_${ph}`] = inPhase.length ? Math.max(...inPhase.map((s) => s.bpm)) : null;
			row[`hr_n_${ph}`] = inPhase.length;
		}
		out[pid] = row;
	}
	return out;
}

/**
 * Peak HR for the two exercise/rest bouts: the strap's peak during interval1 / interval2 when there
 * are readings, otherwise the value typed in on the RPE screen. Keeps the typed value as
 * peak_hr_entered_<n>, records which one was used in peak_hr_source_<n> ('strap' | 'entered'), and
 * recomputes pct_hrmax_<n> (220 − age).
 */
export function applyStrapPeaks(rows: Record<string, unknown>[]): Record<string, unknown>[] {
	return rows.map((r) => {
		const out: Record<string, unknown> = { ...r };
		const age = typeof r.age === 'number' && r.age > 0 ? r.age : null;
		for (const [n, phase] of [
			[1, 'interval1'],
			[2, 'interval2']
		] as const) {
			const strap = r[`hr_peak_${phase}`];
			const entered = r[`peak_hr_${n}`] ?? null;
			const peak = typeof strap === 'number' ? strap : typeof entered === 'number' ? entered : null;
			out[`peak_hr_${n}`] = peak;
			out[`peak_hr_source_${n}`] = typeof strap === 'number' ? 'strap' : peak !== null ? 'entered' : null;
			out[`peak_hr_entered_${n}`] = entered;
			out[`pct_hrmax_${n}`] = peak !== null && age ? peak / (220 - age) : null;
		}
		return out;
	});
}

/**
 * Corrections from the admin page: tags, condition, survey answers, RPE / peak HR and the
 * participant ID itself. Every changed field is logged in the edits table (old → new), so the
 * exported data shows what was corrected and when.
 */
import { error } from '@sveltejs/kit';
import { getDb } from './db';
import { experiment } from './experiment';
import { loadSchedule, saveSchedule } from './files';
import { checkPid } from './http';
import { hasRemoteTag } from '../remote';
import { checkBout, checkSurvey, getSession, makePlan, renamePidRows, type SurveyAnswers } from './session';

export const BOUTS = ['interval1', 'interval2'] as const;
type Bout = (typeof BOUTS)[number];

export interface ParticipantEdit {
	pid?: string;
	condition?: string;
	tags?: string[];
	survey?: SurveyAnswers;
	/** null removes the bout's row. */
	bouts?: Partial<Record<Bout, { rpe: number; peak_hr: number | null } | null>>;
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _./+-]{0,31}$/u;

/** Trim, check and de-duplicate (case-insensitively) a list of tags. */
export function cleanTags(tags: unknown, max = 12): string[] {
	if (!Array.isArray(tags)) error(400, 'tags must be a list');
	const out: string[] = [];
	for (const raw of tags) {
		if (typeof raw !== 'string') error(400, 'tags must be text');
		const t = raw.trim().replace(/\s+/g, ' ');
		if (!t) continue;
		if (!TAG.test(t)) error(400, `Tag "${t}": up to 32 letters, digits, spaces or _ . / + - (no commas)`);
		if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
	}
	if (out.length > max) error(400, `At most ${max} tags`);
	return out;
}

/** cleanTags, comma separated, as stored on a session. */
export const normalizeTags = (tags: unknown): string => cleanTags(tags).join(', ');

export const splitTags = (tags: string | null | undefined): string[] =>
	(tags ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Apply the changes; returns the participant's (possibly new) pid and the fields that changed. */
export function editParticipant(pid: string, e: ParticipantEdit): { pid: string; changed: string[] } {
	const db = getDb();
	return db.transaction(() => {
		const s = getSession(pid);
		if (!s) error(404, `No session for ${pid}`);
		const now = Date.now();
		const log: { field: string; old: unknown; new: unknown }[] = [];

		if (e.condition !== undefined && e.condition !== s.condition) {
			if (!experiment().config.conditions.includes(e.condition)) error(400, `Unknown condition "${e.condition}"`);
			db.prepare('UPDATE sessions SET condition = ? WHERE pid = ?').run(e.condition, pid);
			log.push({ field: 'condition', old: s.condition, new: e.condition });
			// Keep the schedule in step, so new participants are balanced on the condition actually run.
			const rows = loadSchedule();
			const row = rows.find((r) => r.pid === pid);
			if (row && row.condition !== e.condition) {
				row.condition = e.condition;
				saveSchedule(rows);
			}
		}

		if (e.tags !== undefined) {
			const tags = normalizeTags(e.tags);
			if (tags !== (s.tags ?? '')) {
				// The RP tag makes a session remote, which drops the environment questions from its plan.
				const remote = hasRemoteTag(tags);
				if (remote !== hasRemoteTag(s.tags)) {
					if (db.prepare('SELECT 1 FROM sa_responses WHERE pid = ? LIMIT 1').get(pid)) {
						error(409, `${pid} has already answered questions; the RP (remote) tag can no longer be ${remote ? 'added' : 'removed'}`);
					}
					const plan = makePlan(pid, { seed: s.schedule_seed, board_a_theme: s.board_a_theme, board_b_theme: s.board_b_theme }, remote);
					db.prepare('UPDATE sessions SET sa_plan = ? WHERE pid = ?').run(JSON.stringify(plan), pid);
				}
				db.prepare('UPDATE sessions SET tags = ? WHERE pid = ?').run(tags, pid);
				log.push({ field: 'tags', old: s.tags ?? '', new: tags });
			}
		}

		if (e.survey !== undefined) {
			const old = db.prepare('SELECT age, exercise_days, fitness, hours_slept FROM survey WHERE pid = ?').get(pid) as SurveyAnswers | undefined;
			if (!old) error(409, `${pid} has no survey yet; it is filled in at the start of the session`);
			checkSurvey(e.survey);
			const keys = ['age', 'exercise_days', 'fitness', 'hours_slept'] as const;
			const diff = keys.filter((k) => old[k] !== e.survey![k]);
			if (diff.length) {
				db.prepare('UPDATE survey SET age = ?, exercise_days = ?, fitness = ?, hours_slept = ? WHERE pid = ?').run(
					e.survey.age,
					e.survey.exercise_days,
					e.survey.fitness,
					e.survey.hours_slept,
					pid
				);
				for (const k of diff) log.push({ field: `survey.${k}`, old: old[k], new: e.survey[k] });
			}
		}

		for (const [bout, v] of Object.entries(e.bouts ?? {}) as [Bout, { rpe: number; peak_hr: number | null } | null | undefined][]) {
			if (!BOUTS.includes(bout)) error(400, `Unknown bout "${bout}"`);
			if (v === undefined) continue;
			const old = db.prepare('SELECT rpe, peak_hr FROM bouts WHERE pid = ? AND bout = ?').get(pid, bout) as { rpe: number; peak_hr: number | null } | undefined;
			if (v === null) {
				if (old) {
					db.prepare('DELETE FROM bouts WHERE pid = ? AND bout = ?').run(pid, bout);
					log.push({ field: `${bout}.rpe`, old: old.rpe, new: null }, { field: `${bout}.peak_hr`, old: old.peak_hr, new: null });
				}
				continue;
			}
			checkBout(v.rpe, v.peak_hr);
			if (old?.rpe === v.rpe && old?.peak_hr === v.peak_hr) continue;
			if (old) db.prepare('UPDATE bouts SET rpe = ?, peak_hr = ? WHERE pid = ? AND bout = ?').run(v.rpe, v.peak_hr, pid, bout);
			else db.prepare('INSERT INTO bouts (pid, bout, rpe, peak_hr, server_ts) VALUES (?, ?, ?, ?, ?)').run(pid, bout, v.rpe, v.peak_hr, now);
			if (old?.rpe !== v.rpe) log.push({ field: `${bout}.rpe`, old: old?.rpe, new: v.rpe });
			if ((old?.peak_hr ?? null) !== v.peak_hr) log.push({ field: `${bout}.peak_hr`, old: old?.peak_hr, new: v.peak_hr });
		}

		// The pid last, so everything above (and its log rows) moves with it.
		let to = pid;
		if (e.pid !== undefined && e.pid !== pid) {
			to = checkPid(e.pid);
			if (getSession(to)) error(409, `${to} already has a session`);
			renamePidRows(pid, to);
			log.push({ field: 'pid', old: pid, new: to });
		}

		if (log.length) {
			const ins = db.prepare('INSERT INTO edits (pid, field, old_value, new_value, server_ts) VALUES (?, ?, ?, ?, ?)');
			for (const l of log) ins.run(to, l.field, str(l.old), str(l.new), now);
		}
		return { pid: to, changed: log.map((l) => l.field) };
	})();
}

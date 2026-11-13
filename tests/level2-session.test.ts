/**
 * End-to-end through the server code: a test session in the SA phase answers every question,
 * then the responses table and summary CSV are checked. Uses a throwaway DATA_DIR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SaStep } from '../src/lib/sa-plan';
import type { ExperimentConfig } from '../src/lib/types';

let dir: string;
let session: typeof import('../src/lib/server/session');
let admin: typeof import('../src/lib/server/admin');
let db: typeof import('../src/lib/server/db');
const config: ExperimentConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-level2-'));
	process.env.DATA_DIR = dir;
	session = await import('../src/lib/server/session');
	admin = await import('../src/lib/server/admin');
	db = await import('../src/lib/server/db');
});
afterAll(() => {
	db.getDb().close();
	fs.rmSync(dir, { recursive: true, force: true });
});

const timing = { rt_ms: 1000, confidence_rt_ms: 1500, submit_rt_ms: 2000, answer_changes: 0, confidence_changes: 0, client_ts: 1 };

function answer(step: SaStep): { response: unknown; confidence: number | null } {
	if (step.type === 'objects') return { response: step.items.slice(0, 8), confidence: null };
	if (step.type === 'level2_color') {
		const q = config.sa_level2_questions![step.theme].find((x) => x.id === step.item)!;
		// beaver: color blind; Apollo: don't remember; dome: wrong; others right
		if (step.item === 'mit_same_color_beaver') return { response: 'color_blind', confidence: null };
		if (step.item === 'mit_same_color_apollo') return { response: 'dont_remember', confidence: null };
		if (step.item === 'mit_same_color_dome') return { response: step.options.find((o) => o !== q.answer), confidence: 2 };
		return { response: q.answer, confidence: 4 };
	}
	if (step.type === 'level2_count') return { response: '4', confidence: 3 }; // wrong (answer 3)
	// facilitator marks: hat correct, sticky note incorrect
	if (step.type === 'oral') return { response: step.item === 'env_facilitator_hat' ? 'correct' : 'incorrect', confidence: null };
	if (step.type === 'color') return { response: 'red', confidence: 3 };
	if (step.type === 'side_by_side') return { response: step.original_side, confidence: 3 };
	return { response: 'up', confidence: 3 };
}

describe('Level 2 through a session', () => {
	it('stores, scores and exports Level 2 answers', () => {
		const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'sa', fast: true });
		const plan: SaStep[] = JSON.parse(session.getSession(pid)!.sa_plan);
		expect(plan).toHaveLength(18);
		for (const step of plan) session.recordSa(pid, { seq: step.seq, ...answer(step), ...timing } as any);

		const rows = db.getDb().prepare("SELECT * FROM sa_responses WHERE pid = ? AND question_type LIKE 'level2_%' ORDER BY seq").all(pid) as any[];
		expect(rows).toHaveLength(6);
		const by = Object.fromEntries(rows.map((r) => [r.item, r]));
		expect(by.transport_same_color_train).toMatchObject({ question_type: 'level2_color', board: 'B', target: 'bike', response: 'bike', correct: 1, confidence: 4, rt_ms: 1000, confidence_rt_ms: 1500, submit_rt_ms: 2000 });
		expect(by.transport_count_fly).toMatchObject({ question_type: 'level2_count', target: '3', response: '4', correct: 0, confidence: 3 });
		expect(by.mit_same_color_beaver).toMatchObject({ response: 'color_blind', correct: 0, confidence: null, confidence_rt_ms: null });
		expect(by.mit_same_color_apollo).toMatchObject({ response: 'dont_remember', correct: 0, confidence: null });
		expect(by.mit_same_color_dome).toMatchObject({ correct: 0, confidence: 2 });
		const presented = JSON.parse(by.mit_same_color_dome.presented);
		expect(presented.options).toHaveLength(4);
		expect(presented.options).not.toContain('great_dome');
		expect(presented.hex).toBe(config.sa_level2_neutral_hex);
		expect(rows.every((r) => r.client_ts === 1 && r.server_ts > 0)).toBe(true);

		expect(admin.tableCsv('sa_responses')).not.toContain(pid); // test sessions stay out of exports

		const summary = admin.summaryRows(true).find((r) => r.pid === pid)!;
		// Level 2 scored: train ✓, plane ✓, count ✗, apollo don't remember ✗, dome ✗ (beaver color blind excluded)
		expect(summary.level2_n).toBe(5);
		expect(summary.level2_acc).toBe(0.4);
		expect(summary.level2_acc_excl_color).toBe(0);
		expect(summary.q_level2_count_acc).toBe(0);
		expect(summary.q_level2_color_acc).toBe(0.5);
		expect(summary.color_blind_answers).toBe(1);
		// environment answers as marked by the facilitator
		expect(summary.sa_env_n).toBe(2);
		expect(summary.sa_env_acc).toBe(0.5);
		const oral = db.getDb().prepare("SELECT item, target, response, correct, confidence FROM sa_responses WHERE pid = ? AND question_type = 'oral' ORDER BY seq").all(pid);
		expect(oral).toEqual([
			{ item: 'env_facilitator_hat', target: 'correct', response: 'correct', correct: 1, confidence: null },
			{ item: 'env_laptop_sticky_note', target: 'correct', response: 'incorrect', correct: 0, confidence: null }
		]);
	});

	it('rejects "I\'m color blind" on the count question and unknown options', () => {
		const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'transport', board_b_theme: 'mit', phase: 'sa', fast: true });
		const plan: SaStep[] = JSON.parse(session.getSession(pid)!.sa_plan);
		const stop = plan.findIndex((s) => s.type === 'level2_count');
		for (const step of plan.slice(0, stop)) session.recordSa(pid, { seq: step.seq, ...answer(step), ...timing } as any);
		expect(() => session.recordSa(pid, { seq: stop, response: 'color_blind', confidence: null, ...timing } as any)).toThrow();
		const color = plan.findIndex((s) => s.type === 'level2_color');
		expect(color).toBeLessThan(stop);
	});

	it('accepts only correct / incorrect / didn\'t remember for environment questions', () => {
		const pid = session.createTestSession({ condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'sa', fast: true });
		const plan: SaStep[] = JSON.parse(session.getSession(pid)!.sa_plan);
		const first = plan.findIndex((s) => s.type === 'oral');
		for (const step of plan.slice(0, first)) session.recordSa(pid, { seq: step.seq, ...answer(step), ...timing } as any);
		expect(() => session.recordSa(pid, { seq: first, response: 'red', confidence: null, ...timing } as any)).toThrow();
		session.recordSa(pid, { seq: first, response: 'dont_remember', confidence: null, ...timing } as any);
		const r = db.getDb().prepare('SELECT response, correct FROM sa_responses WHERE pid = ? AND seq = ?').get(pid, first);
		expect(r).toEqual({ response: 'dont_remember', correct: 0 });
	});

		it('writes the Level 2 columns to summary.csv', async () => {
		const { toCsv, parseCsv } = await import('../src/lib/csv');
		// summary.csv is toCsv(summaryRows()); test sessions are only included with includeTests.
		const rows = parseCsv(toCsv(admin.summaryRows(true))) as Record<string, string>[];
		const first = rows.find((r) => r.level2_n === '5')!;
		expect(first).toBeDefined();
		expect(first.level2_acc).toBe('0.4');
		expect(first.level2_acc_excl_color).toBe('0');
		for (const col of ['level2_acc_known', 'level2_dont_remember_rate', 'level2_conf', 'q_level2_color_acc', 'q_level2_count_acc', 'q_level2_color_acc_A', 'memory_acc', 'sa_env_acc']) {
			expect(Object.keys(first)).toContain(col);
		}
	});
});

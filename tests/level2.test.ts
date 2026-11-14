import fs from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Sa from '../src/lib/components/Sa.svelte';
import { buildSummary, rescoreFixedAnswers } from '../src/lib/metrics';
import { renderSpec } from '../src/lib/render';
import { mulberry32 } from '../src/lib/rng';
import { buildSaPlan, level2ColorOptions, type SaStep } from '../src/lib/sa-plan';
import { LEVEL2_NEUTRAL_HEX, type ExperimentConfig, type ThemeManifest } from '../src/lib/types';
import { validateExperiment } from '../src/lib/validate';

const config: ExperimentConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const manifests: Record<string, ThemeManifest> = Object.fromEntries(
	['transport', 'mit'].map((t) => [t, JSON.parse(fs.readFileSync(`assets/themes/${t}/manifest.json`, 'utf8'))])
);
const level2 = config.sa_level2_questions!;
const hex = config.sa_level2_neutral_hex ?? LEVEL2_NEUTRAL_HEX;

/** The plan exactly as session.ts builds it from config.json. */
function plan(seed: number, order = config.theme_orders[seed % 2]): SaStep[] {
	return buildSaPlan(
		[
			{ board: 'A', theme: order[0] },
			{ board: 'B', theme: order[1] }
		],
		manifests,
		config.sa_questions,
		mulberry32(seed),
		config.sa_random_per_theme,
		config.sa_foils_per_theme,
		(config.oral_sa_questions ?? []).map((q) => q.id),
		{ questions: level2, rand: mulberry32(seed + 1000) },
		config.sa_side_by_side
	);
}

const level1Item = ['color', 'orientation', 'side_by_side'];
const isL2 = (s: SaStep) => s.type === 'level2_color' || s.type === 'level2_count';

describe('SA plan from config.json', () => {
	it('asks 21 questions: 2 grids, 11 Level 1 items (4 color + 7 fixed side-by-side), 6 Level 2, 2 environment', () => {
		for (let seed = 0; seed < 50; seed++) {
			const p = plan(seed);
			expect(p).toHaveLength(21);
			expect(p.filter((s) => s.type === 'objects')).toHaveLength(2);
			expect(p.filter((s) => level1Item.includes(s.type))).toHaveLength(11);
			expect(p.filter((s) => s.type === 'color')).toHaveLength(4);
			// the same side-by-side objects for everyone
			const sbs = (t: string) => p.filter((s) => s.type === 'side_by_side' && s.theme === t).map((s) => ('item' in s ? s.item : '')).sort();
			expect(sbs('transport')).toEqual(['car', 'helicopter', 'plane', 'rocket']);
			expect(sbs('mit')).toEqual(['apollo_capsule', 'beaver', 'muddy_charles']);
			// color questions are about other objects, never one asked side by side
			const colorItems = p.filter((s) => s.type === 'color').map((s) => (s as { item: string }).item);
			for (const id of colorItems) expect([...sbs('transport'), ...sbs('mit')]).not.toContain(id);
			expect(new Set(colorItems).size).toBe(4);
			expect(p.filter(isL2)).toHaveLength(6);
			expect(p.filter((s) => s.type === 'level2_color')).toHaveLength(5);
			expect(p.filter((s) => s.type === 'level2_count')).toHaveLength(1);
			expect(p.filter((s) => s.type === 'oral').map((s) => s.item)).toEqual(['env_facilitator_hat', 'env_sticky_note']);
			expect(p.map((s) => s.seq)).toEqual(p.map((_, i) => i));
		}
	});

	it('orders each theme block grid, Level 1 items, Level 2 (config order); environment last', () => {
		const firsts = new Set<string>();
		for (let seed = 0; seed < 50; seed++) {
			const p = plan(seed);
			expect(p.slice(-2).every((s) => s.type === 'oral')).toBe(true);
			const split = p.findIndex((s) => s.theme !== p[0].theme);
			for (const block of [p.slice(0, split), p.slice(split, -2)]) {
				const theme = block[0].theme;
				const nL1 = 2 + config.sa_side_by_side![theme].length;
				expect(block.every((s) => s.theme === theme)).toBe(true);
				expect(block[0].type).toBe('objects');
				expect(block.slice(1, 1 + nL1).every((s) => level1Item.includes(s.type))).toBe(true);
				expect(block.slice(1 + nL1).map((s) => ('item' in s ? s.item : ''))).toEqual(level2[theme].map((q) => q.id));
			}
			firsts.add(p[0].theme);
		}
		expect(firsts).toEqual(new Set(['transport', 'mit'])); // theme blocks still in random order
	});

	it('leaves the Level 1 questions unchanged by adding Level 2', () => {
		for (let seed = 0; seed < 20; seed++) {
			const order = config.theme_orders[seed % 2];
			const boards = [
				{ board: 'A', theme: order[0] },
				{ board: 'B', theme: order[1] }
			];
			const without = buildSaPlan(boards, manifests, config.sa_questions, mulberry32(seed), config.sa_random_per_theme, config.sa_foils_per_theme, [], undefined, config.sa_side_by_side);
			const strip = (s: SaStep) => ({ ...s, seq: 0 });
			expect(plan(seed).filter((s) => !isL2(s) && s.type !== 'oral').map(strip)).toEqual(without.map(strip));
		}
	});

	it('passes validation', () => {
		const layouts = JSON.parse(fs.readFileSync('assets/layouts.json', 'utf8'));
		const practice = JSON.parse(fs.readFileSync(`assets/themes/${config.practice_board.theme}/manifest.json`, 'utf8'));
		const all = { ...manifests, [config.practice_board.theme]: practice };
		expect(validateExperiment(config, all, layouts, () => true)).toEqual([]);
		// no more than 2 environment questions
		const three = { ...config, oral_sa_questions: [...config.oral_sa_questions!, { id: 'env_third', prompt: 'x', options: config.oral_sa_questions![0].options }] };
		expect(validateExperiment(three, all, layouts, () => true)).toEqual(['config.oral_sa_questions: at most 2 environment questions (hat and sticky note)']);
	});
});

describe('Level 2 color-pair options', () => {
	const colorQs = Object.entries(level2).flatMap(([theme, qs]) => qs.flatMap((q) => (q.kind === 'color_pair' ? [{ theme, q }] : [])));

	it('has the answer the same color as the cue', () => {
		for (const { theme, q } of colorQs) {
			const color = (id: string) => manifests[theme].objects.find((o) => o.id === id)!.color;
			expect(color(q.answer)).toBe(color(q.cue));
		}
	});

	it('shows 4 seen objects from the theme, always the answer, never the cue', () => {
		for (const { theme, q } of colorQs) {
			for (let seed = 0; seed < 200; seed++) {
				const opts = level2ColorOptions(manifests[theme], q, mulberry32(seed));
				expect(opts).toHaveLength(4);
				expect(new Set(opts).size).toBe(4);
				expect(opts).toContain(q.answer);
				expect(opts).not.toContain(q.cue);
				const cueColor = manifests[theme].objects.find((o) => o.id === q.cue)!.color;
				for (const id of opts) {
					const o = manifests[theme].objects.find((x) => x.id === id);
					expect(o).toBeDefined(); // a seen object, not a foil
					expect(o!.render).not.toBe('original'); // can be drawn in gray
					if (id !== q.answer) expect(o!.color).not.toBe(cueColor); // exactly one right answer
				}
			}
		}
		// the same steps appear in generated plans
		for (let seed = 0; seed < 50; seed++) {
			for (const s of plan(seed)) {
				if (s.type !== 'level2_color') continue;
				const q = level2[s.theme].find((x) => x.id === s.item)!;
				expect(q.kind === 'color_pair' && s.options.includes(q.answer) && !s.options.includes(q.cue)).toBe(true);
			}
		}
	});

	it('draws every option in the neutral color', () => {
		for (const { theme, q } of colorQs) {
			for (const id of level2ColorOptions(manifests[theme], q, mulberry32(1))) {
				const item = manifests[theme].objects.find((o) => o.id === id)!;
				expect(renderSpec(theme, item, config.colors, config.orientations, { hex }).hex).toBe(hex);
			}
		}
	});

	it('renders in Sa.svelte with only the neutral color and no color-blind option', () => {
		const p = plan(3);
		const at = p.findIndex((s) => s.type === 'level2_color');
		const { body } = render(Sa, {
			props: {
				plan: p,
				answered: at,
				manifests,
				colors: config.colors,
				orientations: config.orientations,
				scale: 4,
				labels: ['Guessing', 'Very sure'],
				level2Hex: hex,
				onAnswer: async () => ({}),
				onDone: () => {}
			}
		});
		const fills = [...body.matchAll(/background-color:\s*([^;"]+)/g)].map((m) => m[1].trim());
		expect(fills).toHaveLength(4);
		expect(new Set(fills)).toEqual(new Set([hex]));
		for (const c of config.colors) expect(body).not.toContain(c.hex);
		expect(body).toContain("I don't remember");
		expect(body).not.toContain('color blind');
	});

	it('renders the count question as text options', () => {
		const p = plan(0, ['transport', 'mit']);
		const at = p.findIndex((s) => s.type === 'level2_count');
		const { body } = render(Sa, {
			props: {
				plan: p,
				answered: at,
				manifests,
				colors: config.colors,
				orientations: config.orientations,
				scale: 4,
				labels: ['Guessing', 'Very sure'],
				onAnswer: async () => ({}),
				onDone: () => {}
			}
		});
		expect(body).toContain('How many of the vehicles could fly?');
		for (const n of ['2', '3', '4', '5']) expect(body).toMatch(new RegExp(`>\\s*${n}\\s*<`));
		expect(body).toContain("I don't remember");
		expect(body).not.toContain("I'm color blind");
	});
});

describe('Level 2 summary columns', () => {
	const base = { pid: 'P01', confidence: 3 as number | null };
	const summarize = (sa: Parameters<typeof buildSummary>[0]['sa']) =>
		buildSummary({
			sessions: [{ pid: 'P01', condition: 'rest', board_a_theme: 'mit', board_b_theme: 'transport', phase: 'done', completed_at: 1 }],
			phases: [],
			clicks: [],
			sa,
			survey: [],
			bouts: [],
			layouts: {},
			saTypes: ['objects', 'color', 'side_by_side', 'level2_color', 'level2_count', 'oral']
		})[0];

	it('scores correct, incorrect and "I don\'t remember" answers', () => {
		const row = summarize([
			// Level 1, kept separate
			{ ...base, board: 'A', question_type: 'color', target: 'red', response: 'red', correct: 1 },
			// Level 2
			{ ...base, board: 'A', question_type: 'level2_color', target: 'mit_logo', response: 'mit_logo', correct: 1 },
			{ ...base, board: 'A', question_type: 'level2_color', target: 'integral', response: 'dna_helix', correct: 0 },
			{ ...base, board: 'B', question_type: 'level2_color', target: 'bike', response: 'dont_remember', correct: 0, confidence: null },
			{ ...base, board: 'B', question_type: 'level2_count', target: '3', response: '3', correct: 1, confidence: 4 },
			// environment, kept separate
			{ ...base, board: 'env', question_type: 'oral', target: 'red', response: 'blue', correct: 0 }
		]);
		// 4 Level 2 answers: 2 right, 1 wrong, 1 don't remember
		expect(row.level2_n).toBe(4);
		expect(row.level2_acc).toBe(0.5);
		expect(row.level2_acc_known).toBeCloseTo(2 / 3, 8);
		expect(row.level2_dont_remember_rate).toBe(0.25);
		expect(row.level2_acc_excl_color).toBe(1); // count question only
		expect(row.q_level2_color_acc).toBeCloseTo(1 / 3, 8);
		expect(row.q_level2_color_acc_A).toBe(0.5);
		expect(row.q_level2_color_acc_B).toBe(0);
		expect(row.q_level2_count_acc).toBe(1);
		expect(row.memory_acc).toBe(1);
		expect(row.memory_n).toBe(1);
		expect(row.sa_env_acc).toBe(0);
	});

	it('is blank without Level 2 answers', () => {
		const row = summarize([]);
		expect(row.level2_n).toBe(0);
		expect(row.level2_acc).toBeNull();
		expect(row.level2_acc_excl_color).toBeNull();
	});
});

describe('rescoreFixedAnswers', () => {
	const row = (question_type: string, item: string, response: string, correct: number) => ({ question_type, item, theme: 'transport', target: 'old', response, correct });

	it('re-scores Level 2 answers against the current config', () => {
		const [right, wrong] = rescoreFixedAnswers([row('level2_color', 'transport_same_color_train', 'bike', 0), row('level2_color', 'transport_same_color_train', 'car', 1)], level2);
		expect([right.target, right.correct]).toEqual(['bike', 1]);
		expect([wrong.target, wrong.correct]).toEqual(['bike', 0]);
	});

	it('leaves facilitator-marked environment answers as recorded', () => {
		const r = row('oral', 'env_facilitator_hat', 'correct', 1);
		expect(rescoreFixedAnswers([r], level2)[0]).toBe(r);
	});
});

describe('environment question screen', () => {
	const p = plan(0);
	const props = {
		plan: p,
		answered: p.findIndex((s) => s.type === 'oral'),
		manifests,
		colors: config.colors,
		orientations: config.orientations,
		scale: 4,
		labels: ['Guessing', 'Very sure'] as [string, string],
		oralQuestions: config.oral_sa_questions,
		onAnswer: async () => ({}),
		onDone: () => {}
	};

	it('tells the participant to talk to the facilitator and hides the questions', () => {
		const { body } = render(Sa, { props });
		expect(body).toContain('Please stand up and talk to your facilitator, who will ask you some questions about the environment.');
		expect(body).not.toContain("What color was the facilitator's hat?");
		expect(body).not.toContain('Correct');
		expect(body).not.toMatch(/Question \d+ of/);
	});

	it('has no answer key in the config: the facilitator marks each answer', () => {
		for (const q of config.oral_sa_questions!) expect(q).not.toHaveProperty('answer');
		expect(config.oral_sa_questions!.map((q) => q.prompt)).toEqual([
			"What color was the facilitator's hat?",
			'What color was the sticky note?'
		]);
	});
});

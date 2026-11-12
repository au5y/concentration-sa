/** Data for the /preview review page: every item, alternative candidates, and saved feedback. */
import fs from 'node:fs';
import path from 'node:path';
import { buildSaPlan } from '../sa-plan';
import { mulberry32 } from '../rng';
import { experiment } from './experiment';
import { paths } from './files';

export interface Candidate {
	file: string;
	render: 'mask' | 'original';
	source: string;
	license: string;
	author?: string;
	url?: string;
	/** Shown on the tile, e.g. "Replace with: Simmons Hall". */
	label?: string;
}

export const candidatesDir = () => path.join(paths.assets, 'candidates');
export const feedbackFile = () => path.join(paths.data, 'preview-feedback.json');

export function previewData() {
	const exp = experiment();
	const { config, manifests } = exp;
	const themes = [...new Set(config.theme_orders.flat())];
	const indexFile = path.join(candidatesDir(), 'index.json');
	const candidates: Record<string, Record<string, Candidate[]>> = fs.existsSync(indexFile)
		? JSON.parse(fs.readFileSync(indexFile, 'utf8'))
		: {};
	const feedback = fs.existsSync(feedbackFile()) ? JSON.parse(fs.readFileSync(feedbackFile(), 'utf8')) : null;
	const [a, b] = config.theme_orders[0];
	const demoPlan = buildSaPlan(
		[
			{ board: 'A', theme: a },
			{ board: 'B', theme: b }
		],
		manifests,
		config.sa_questions,
		mulberry32(Date.now() & 0xffff),
		config.sa_random_per_theme,
		config.sa_foils_per_theme,
		(config.oral_sa_questions ?? []).map((q) => q.id)
	);
	return {
		themes,
		manifests: Object.fromEntries(themes.map((t) => [t, manifests[t]])),
		colors: config.colors,
		oralQuestions: config.oral_sa_questions ?? [],
		orientations: config.orientations,
		confidenceScale: config.confidence_scale,
		confidenceLabels: config.confidence_labels ?? (['Not at all sure', 'Completely sure'] as [string, string]),
		settings: {
			sa_questions: config.sa_questions,
			sa_random_per_theme: config.sa_random_per_theme ?? null,
			sa_foils_per_theme: config.sa_foils_per_theme ?? null,
			confidence_scale: config.confidence_scale
		},
		candidates,
		feedback,
		demoPlan
	};
}

export function saveFeedback(fb: unknown) {
	fs.mkdirSync(paths.data, { recursive: true });
	fs.writeFileSync(feedbackFile(), JSON.stringify({ ...(fb as object), saved_at: new Date().toISOString() }, null, '\t') + '\n');
}

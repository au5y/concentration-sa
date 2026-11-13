import type { ExperimentConfig, LayoutsFile, ThemeManifest } from '../types';
import { experimentWarnings, validateExperiment } from '../validate';
import { loadConfig, loadLayouts, loadManifests, themeFileExists } from './files';

export interface Experiment {
	config: ExperimentConfig;
	manifests: Record<string, ThemeManifest>;
	layouts: LayoutsFile;
	devTimers: boolean;
}

let cached: Experiment | null = null;

/** Load and validate config/manifests/layouts once per process. Throws with every problem listed. */
export function experiment(): Experiment {
	if (cached) return cached;
	const config = loadConfig();
	const manifests = loadManifests(config);
	const layouts = loadLayouts();
	const errs = validateExperiment(config, manifests, layouts, themeFileExists);
	if (errs.length) throw new Error('Experiment setup is invalid:\n' + errs.map((e) => ' - ' + e).join('\n'));
	for (const w of experimentWarnings(config)) console.warn('warning: ' + w);
	cached = {
		config,
		manifests: manifests as Record<string, ThemeManifest>,
		layouts: layouts!,
		devTimers: ['1', 'true', 'yes'].includes((process.env.DEV_TIMERS ?? '').toLowerCase())
	};
	return cached;
}

/** Card timings. `fast` (per test session) shortens the preview like DEV_TIMERS does. */
export function timers(exp: Experiment, fast = false) {
	const { config } = exp;
	const devTimers = exp.devTimers || fast;
	const dev = 5000;
	return {
		preview_ms: devTimers ? dev : config.preview_s * 1000,
		mismatch_flip_ms: config.mismatch_flip_ms,
		/** Play time allowed per board; 0 = no limit. Not shortened by fast timers. */
		time_limit_ms: Math.round((config.board_time_limit_s ?? 0) * 1000)
	};
}

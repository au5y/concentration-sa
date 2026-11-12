/** Filesystem loading shared by the server and the CLI scripts. */
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../csv';
import type { ExperimentConfig, LayoutsFile, ScheduleRow, ThemeManifest } from '../types';
import { experimentThemes } from '../validate';

export const paths = {
	get config() {
		return path.resolve(process.env.CONFIG_PATH ?? 'config.json');
	},
	get assets() {
		return path.resolve(process.env.ASSETS_DIR ?? 'assets');
	},
	get data() {
		return path.resolve(process.env.DATA_DIR ?? 'data');
	},
	get schedule() {
		return path.resolve(process.env.SCHEDULE_PATH ?? path.join(this.data, 'schedule.csv'));
	},
	get layouts() {
		return path.join(this.assets, 'layouts.json');
	},
	themeDir(theme: string) {
		return path.join(this.assets, 'themes', theme);
	}
};

export function loadConfig(file = paths.config): ExperimentConfig {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadManifests(config: ExperimentConfig): Record<string, ThemeManifest | undefined> {
	const { sa, practice } = experimentThemes(config);
	const out: Record<string, ThemeManifest | undefined> = {};
	for (const theme of [...sa, practice]) {
		const f = path.join(paths.themeDir(theme), 'manifest.json');
		out[theme] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
	}
	return out;
}

export function loadLayouts(): LayoutsFile | null {
	return fs.existsSync(paths.layouts) ? JSON.parse(fs.readFileSync(paths.layouts, 'utf8')) : null;
}

export function themeFileExists(theme: string, file: string): boolean {
	const dir = paths.themeDir(theme);
	const full = path.resolve(dir, file);
	return full.startsWith(dir + path.sep) && fs.existsSync(full);
}

export function loadSchedule(file = paths.schedule): ScheduleRow[] {
	if (!fs.existsSync(file)) return [];
	return parseCsv(fs.readFileSync(file, 'utf8')).map((r) => ({
		pid: r.pid,
		condition: r.condition,
		board_a_theme: r.board_a_theme,
		board_b_theme: r.board_b_theme,
		seed: Number(r.seed)
	}));
}

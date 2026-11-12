import { hasVariant } from './sa-plan';
import { COLOR_BLIND, DONT_REMEMBER } from './types';
import type { ExperimentConfig, LayoutsFile, ThemeManifest } from './types';

export function experimentThemes(config: ExperimentConfig): { sa: string[]; practice: string } {
	return { sa: [...new Set(config.theme_orders.flat())], practice: config.practice_board.theme };
}

/** Check config, manifests and layouts for consistency. Returns a list of problems (empty = OK). */
export function validateExperiment(
	config: ExperimentConfig,
	manifests: Record<string, ThemeManifest | undefined>,
	layouts: LayoutsFile | null,
	fileExists: (theme: string, file: string) => boolean
): string[] {
	const errs: string[] = [];
	const colorIds = new Set(config.colors.map((c) => c.id));
	const orientIds = new Set(config.orientations.map((o) => o.id));
	if (config.colors.length < 2) errs.push('config.colors needs at least 2 entries');
	if (config.orientations.length < 2) errs.push('config.orientations needs at least 2 entries');
	for (const cond of config.conditions) {
		if (!config.condition_text?.[cond]) errs.push(`config.condition_text is missing condition "${cond}"`);
	}
	for (const order of config.theme_orders) {
		if (order.length !== 2) errs.push(`theme order ${JSON.stringify(order)} must list exactly 2 themes`);
	}

	const { sa, practice } = experimentThemes(config);
	const check = (theme: string, dims: { rows: number; cols: number }, needsFoils: boolean) => {
		const m = manifests[theme];
		if (!m) return void errs.push(`theme "${theme}": manifest.json not found`);
		const pairs = (dims.rows * dims.cols) / 2;
		if (!Number.isInteger(pairs)) errs.push(`board ${dims.rows}x${dims.cols} has an odd number of cards`);
		if (m.objects.length !== pairs) errs.push(`theme "${theme}": needs ${pairs} objects, has ${m.objects.length}`);
		if (needsFoils && config.sa_questions.includes('objects') && m.foils.length < 1) {
			errs.push(`theme "${theme}": needs foils for the objects question`);
		}
		const ids = new Set<string>();
		for (const item of [...m.objects, ...(needsFoils ? m.foils : [])]) {
			const where = `theme "${theme}" item "${item.id}"`;
			if (ids.has(item.id)) errs.push(`${where}: duplicate id`);
			ids.add(item.id);
			if (item.emoji) {
				if (needsFoils) errs.push(`${where}: emoji items are only supported on the practice board`);
				continue;
			}
			if (!item.image) errs.push(`${where}: no image`);
			else if (!fileExists(theme, item.image)) errs.push(`${where}: image file ${item.image} missing`);
			if (item.render && item.render !== 'mask' && item.render !== 'original') errs.push(`${where}: render must be "mask" or "original"`);
			if (item.render === 'original' && item.variant?.color_shift_deg) {
				errs.push(`${where}: color_shift_deg has no effect on an original image; use mirror/scale/image`);
			}
			if (needsFoils) {
				if (item.render !== 'original' && (!item.color || !colorIds.has(item.color))) errs.push(`${where}: unknown color "${item.color}"`);
				if (!item.orientation || !orientIds.has(item.orientation)) {
					errs.push(`${where}: unknown orientation "${item.orientation}"`);
				}
			}
			if (item.variant?.image && !fileExists(theme, item.variant.image)) {
				errs.push(`${where}: variant image ${item.variant.image} missing`);
			}
		}
		// Objects without a variant are simply never asked side-by-side; make sure enough are left.
		if (needsFoils && config.sa_questions.includes('side_by_side')) {
			if (!m.objects.some(hasVariant)) errs.push(`theme "${theme}": no object has a variant for side_by_side`);
		}
		if (needsFoils && config.sa_questions.includes('color')) {
			if (!m.objects.some((o) => o.render !== 'original')) errs.push(`theme "${theme}": no recolorable object for color questions`);
		}
		const layout = layouts?.layouts[theme];
		if (!layout) return void errs.push(`theme "${theme}": no layout in layouts.json (run npm run layouts)`);
		if (layout.rows !== dims.rows || layout.cols !== dims.cols) {
			errs.push(`theme "${theme}": layout is ${layout.rows}x${layout.cols}, config wants ${dims.rows}x${dims.cols}`);
		}
		const counts = new Map<string, number>();
		for (const id of layout.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
		for (const o of m.objects) {
			if (counts.get(o.id) !== 2) errs.push(`theme "${theme}": layout must contain "${o.id}" exactly twice`);
		}
		if (layout.cards.length !== dims.rows * dims.cols) errs.push(`theme "${theme}": layout has wrong card count`);
	};
	if (config.sa_foils_per_theme !== undefined && (!Number.isInteger(config.sa_foils_per_theme) || config.sa_foils_per_theme < 0)) {
		errs.push('config.sa_foils_per_theme must be a whole number >= 0');
	}
	if (!Number.isInteger(config.confidence_scale) || config.confidence_scale < 0) {
		errs.push('config.confidence_scale must be a whole number (0 turns confidence off)');
	}
	const oralIds = new Set<string>();
	for (const q of config.oral_sa_questions ?? []) {
		const where = `oral_sa_questions "${q.id}"`;
		if (!q.id || oralIds.has(q.id)) errs.push(`${where}: missing or duplicate id`);
		oralIds.add(q.id);
		if (!q.prompt) errs.push(`${where}: no prompt`);
		if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${where}: needs at least 2 options`);
		else if (!q.options.some((o) => o.id === q.answer)) errs.push(`${where}: answer "${q.answer}" is not one of its option ids`);
		if (q.options?.some((o) => o.id === DONT_REMEMBER || o.id === COLOR_BLIND)) errs.push(`${where}: option ids "${DONT_REMEMBER}"/"${COLOR_BLIND}" are reserved`);
	}
	for (const t of sa) check(t, config.board, true);
	check(practice, config.practice_board, false);
	return errs;
}

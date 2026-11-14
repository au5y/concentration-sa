import { hasVariant, level2Distractors } from './sa-plan';
import { DONT_REMEMBER } from './types';
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
	if (config.board_time_limit_s !== undefined && (typeof config.board_time_limit_s !== 'number' || config.board_time_limit_s < 0)) {
		errs.push('config.board_time_limit_s must be a number of seconds >= 0 (0 = no limit)');
	}
	for (const [k, v] of Object.entries(config.interval_timer_s ?? {})) {
		if (k !== 'interval1' && k !== 'interval2') errs.push(`config.interval_timer_s: unknown key "${k}" (interval1 or interval2)`);
		else if (typeof v !== 'number' || v < 0) errs.push(`config.interval_timer_s.${k} must be a number of seconds >= 0 (0 = no countdown)`);
	}
	for (const [theme, items] of Object.entries(config.sa_side_by_side ?? {})) {
		const m = manifests[theme];
		if (!m) errs.push(`config.sa_side_by_side: unknown theme "${theme}"`);
		else for (const id of items) {
			const o = m.objects.find((x) => x.id === id);
			if (!o) errs.push(`config.sa_side_by_side.${theme}: "${id}" is not a seen object`);
			else if (!hasVariant(o)) errs.push(`config.sa_side_by_side.${theme}: "${id}" has no variant`);
		}
		if (!config.sa_questions.includes('side_by_side')) errs.push('config.sa_side_by_side is set but "side_by_side" is not in sa_questions');
	}
	for (const c of config.rpe_conditions ?? []) {
		if (!config.conditions.includes(c)) errs.push(`config.rpe_conditions: "${c}" is not one of config.conditions`);
	}
	if (!Number.isInteger(config.confidence_scale) || config.confidence_scale < 0) {
		errs.push('config.confidence_scale must be a whole number (0 turns confidence off)');
	}
	if ((config.oral_sa_questions?.length ?? 0) > 2) errs.push('config.oral_sa_questions: at most 2 environment questions (hat and sticky note)');
	const oralIds = new Set<string>();
	for (const q of config.oral_sa_questions ?? []) {
		const where = `oral_sa_questions "${q.id}"`;
		if (!q.id || oralIds.has(q.id)) errs.push(`${where}: missing or duplicate id`);
		oralIds.add(q.id);
		if (!q.prompt) errs.push(`${where}: no prompt`);
		if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${where}: needs at least 2 options`);
		if (q.options?.some((o) => o.id === DONT_REMEMBER)) errs.push(`${where}: option id "${DONT_REMEMBER}" is reserved`);
	}
	const level2Ids = new Set<string>();
	for (const [theme, qs] of Object.entries(config.sa_level2_questions ?? {})) {
		const m = manifests[theme];
		if (!sa.includes(theme)) errs.push(`sa_level2_questions: theme "${theme}" is not in theme_orders`);
		if (!m) continue;
		for (const q of qs) {
			const where = `sa_level2_questions "${theme}" "${q.id}"`;
			if (!q.id || level2Ids.has(q.id)) errs.push(`${where}: missing or duplicate id`);
			level2Ids.add(q.id);
			if (!q.prompt) errs.push(`${where}: no prompt`);
			if (q.kind === 'color_pair') {
				const cue = m.objects.find((o) => o.id === q.cue);
				const ans = m.objects.find((o) => o.id === q.answer);
				if (!cue) errs.push(`${where}: cue "${q.cue}" is not a seen object of the theme`);
				if (!ans) errs.push(`${where}: answer "${q.answer}" is not a seen object of the theme`);
				if (cue && ans) {
					if (q.cue === q.answer) errs.push(`${where}: the answer cannot be the cue`);
					if (ans.render === 'original' || ans.emoji) errs.push(`${where}: answer "${q.answer}" cannot be drawn in the neutral color`);
					if (cue.color !== ans.color) errs.push(`${where}: answer "${q.answer}" (${ans.color}) is not the same color as "${q.cue}" (${cue.color})`);
					if (level2Distractors(m, q).length < 3) errs.push(`${where}: needs at least 3 other recolorable objects of a different color as wrong options`);
				}
			} else if (q.kind === 'count') {
				if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${where}: needs at least 2 options`);
				else if (!q.options.some((o) => o.id === q.answer)) errs.push(`${where}: answer "${q.answer}" is not one of its option ids`);
				if (q.options?.some((o) => o.id === DONT_REMEMBER)) errs.push(`${where}: option id "${DONT_REMEMBER}" is reserved`);
			} else {
				errs.push(`${where}: kind must be "color_pair" or "count"`);
			}
		}
	}
	for (const t of sa) check(t, config.board, true);
	check(practice, config.practice_board, false);
	return errs;
}


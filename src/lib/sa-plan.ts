import { shuffle } from './rng';
import type { ManifestItem, SaQuestionType, ThemeManifest } from './types';

export type SaStep =
	| { seq: number; type: 'objects'; board: string; theme: string; items: string[] }
	| { seq: number; type: 'color' | 'orientation'; board: string; theme: string; item: string }
	| { seq: number; type: 'side_by_side'; board: string; theme: string; item: string; original_side: 'left' | 'right' }
	/** Environment SA question read aloud by the facilitator (board/theme are "env"). */
	| { seq: number; type: 'oral'; board: 'env'; theme: 'env'; item: string };

type ItemType = Exclude<SaQuestionType, 'objects'>;

/**
 * Build the SA question sequence. Theme blocks (A/B) come in random order. Each block
 * starts with the recognition grid (if configured), followed by single-item questions:
 *  - perTheme undefined: every non-grid type for every seen object, grouped by type;
 *  - perTheme = n: n questions, types spread as evenly as possible (which types get the
 *    extra ones is random), each about a different seen object, in random order.
 * Color questions are only asked about recolorable (mask) objects, not original images;
 * side-by-side questions only about objects that have a variant.
 * foilsPerTheme limits the grid to a random subset of the foils.
 */
export function buildSaPlan(
	boards: { board: string; theme: string }[],
	manifests: Record<string, ThemeManifest>,
	types: SaQuestionType[],
	rand: () => number,
	perTheme?: number,
	foilsPerTheme?: number,
	/** Oral environment questions (ids), asked after both board blocks, in config order. */
	oral: string[] = []
): SaStep[] {
	const steps: SaStep[] = [];
	let seq = 0;
	const itemTypes = types.filter((t): t is ItemType => t !== 'objects');
	const push = (board: string, theme: string, type: ItemType, item: string) => {
		if (type === 'side_by_side') {
			steps.push({ seq: seq++, type, board, theme, item, original_side: rand() < 0.5 ? 'left' : 'right' });
		} else {
			steps.push({ seq: seq++, type, board, theme, item });
		}
	};

	for (const { board, theme } of shuffle(boards, rand)) {
		const m = manifests[theme];
		const seen = m.objects.map((o) => o.id);
		const byId = new Map(m.objects.map((o) => [o.id, o]));
		const eligible = (type: ItemType, id: string) => canAsk(type, byId.get(id)!);
		if (types.includes('objects')) {
			let foils = m.foils.map((f) => f.id);
			if (foilsPerTheme !== undefined) foils = shuffle(foils, rand).slice(0, foilsPerTheme);
			steps.push({ seq: seq++, type: 'objects', board, theme, items: shuffle([...seen, ...foils], rand) });
		}
		if (perTheme === undefined) {
			for (const type of itemTypes) for (const item of shuffle(seen, rand)) if (eligible(type, item)) push(board, theme, type, item);
			continue;
		}
		if (!itemTypes.length || perTheme <= 0) continue;
		const n = Math.min(perTheme, seen.length);
		const typeList: ItemType[] = [];
		while (typeList.length < n) typeList.push(...shuffle(itemTypes, rand));
		const qTypes = shuffle(typeList.slice(0, n), rand);
		// Give each question a different object. The most restricted question types pick
		// first, so e.g. color questions never land on an original image and side-by-side
		// questions never land on an object without a variant.
		const pool = shuffle(seen, rand);
		const assigned: (string | undefined)[] = new Array(n);
		const nEligible = (t: ItemType) => seen.filter((id) => eligible(t, id)).length;
		const order = qTypes.map((_, i) => i).sort((a, b) => nEligible(qTypes[a]) - nEligible(qTypes[b]));
		for (const i of order) {
			const k = pool.findIndex((id) => eligible(qTypes[i], id));
			if (k >= 0) assigned[i] = pool.splice(k, 1)[0];
		}
		qTypes.forEach((type, i) => {
			if (assigned[i]) push(board, theme, type, assigned[i]!);
		});
	}
	for (const item of oral) steps.push({ seq: seq++, type: 'oral', board: 'env', theme: 'env', item });
	return steps;
}

/** Color: only recolorable (mask) items. Side by side: only items with an altered variant. */
function canAsk(type: ItemType, item: ManifestItem): boolean {
	if (item.emoji) return false;
	if (type === 'color') return item.render !== 'original';
	if (type === 'side_by_side') return hasVariant(item);
	return true;
}

export function hasVariant(item: ManifestItem): boolean {
	const v = item.variant;
	return !!v && !!(v.image || v.mirror || v.scale || v.color_shift_deg);
}

import { shuffle } from './rng';
import type { Level2Question, ManifestItem, SaQuestionType, ThemeManifest } from './types';

export type SaStep =
	| { seq: number; type: 'objects'; board: string; theme: string; items: string[] }
	| { seq: number; type: 'color' | 'orientation'; board: string; theme: string; item: string }
	| { seq: number; type: 'side_by_side'; board: string; theme: string; item: string; original_side: 'left' | 'right' }
	/** Level 2 color pair: item = question id; options = 4 seen object ids (answer + 3 others, never the cue). */
	| { seq: number; type: 'level2_color'; board: string; theme: string; item: string; prompt: string; cue: string; options: string[] }
	/** Level 2 count: item = question id; text options. */
	| { seq: number; type: 'level2_count'; board: string; theme: string; item: string; prompt: string; options: { id: string; label: string }[] }
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
 * Level 2 questions for the theme (if any) close each block, in config order. They draw from
 * their own random stream (level2.rand), so adding them leaves the Level 1 questions unchanged.
 * Oral environment questions come last, after both blocks.
 */
export function buildSaPlan(
	boards: { board: string; theme: string }[],
	manifests: Record<string, ThemeManifest>,
	types: SaQuestionType[],
	rand: () => number,
	perTheme?: number,
	foilsPerTheme?: number,
	/** Oral environment questions (ids), asked after both board blocks, in config order. */
	oral: string[] = [],
	level2?: { questions: Record<string, Level2Question[]>; rand: () => number }
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
		level1Items(board, theme, seen, eligible);
		for (const q of level2?.questions[theme] ?? []) {
			if (q.kind === 'color_pair') {
				const options = level2ColorOptions(m, q, level2!.rand);
				steps.push({ seq: seq++, type: 'level2_color', board, theme, item: q.id, prompt: q.prompt, cue: q.cue, options });
			} else {
				steps.push({ seq: seq++, type: 'level2_count', board, theme, item: q.id, prompt: q.prompt, options: q.options });
			}
		}
	}
	for (const item of oral) steps.push({ seq: seq++, type: 'oral', board: 'env', theme: 'env', item });
	return steps;

	function level1Items(board: string, theme: string, seen: string[], eligible: (type: ItemType, id: string) => boolean) {
		if (perTheme === undefined) {
			for (const type of itemTypes) for (const item of shuffle(seen, rand)) if (eligible(type, item)) push(board, theme, type, item);
			return;
		}
		if (!itemTypes.length || perTheme <= 0) return;
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
}

/**
 * Seen objects that can be a wrong option for a color-pair question: drawable in the neutral
 * color (not an original image or emoji), not the cue or the answer, and not the cue's color.
 */
export function level2Distractors(m: ThemeManifest, q: { cue: string; answer: string }): string[] {
	const cueColor = m.objects.find((o) => o.id === q.cue)?.color;
	return m.objects
		.filter((o) => !o.emoji && o.render !== 'original' && o.id !== q.cue && o.id !== q.answer && o.color !== cueColor)
		.map((o) => o.id);
}

/** The 4 options of a color-pair question: the answer plus 3 random distractors, in random order. */
export function level2ColorOptions(m: ThemeManifest, q: { cue: string; answer: string }, rand: () => number, n = 4): string[] {
	const wrong = shuffle(level2Distractors(m, q), rand).slice(0, n - 1);
	return shuffle([q.answer, ...wrong], rand);
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

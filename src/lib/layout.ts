import { shuffle } from './rng';

/** True if any two cards holding the same object are horizontally or vertically adjacent. */
export function hasAdjacentPair(cards: string[], cols: number): boolean {
	for (let i = 0; i < cards.length; i++) {
		const right = i + 1;
		const below = i + cols;
		if (right % cols !== 0 && right < cards.length && cards[right] === cards[i]) return true;
		if (below < cards.length && cards[below] === cards[i]) return true;
	}
	return false;
}

/**
 * Lay out two copies of each object on a rows x cols board, row-major.
 * Rejection-samples until no pair sits side by side (orthogonally).
 */
export function generateLayout(
	objectIds: string[],
	rows: number,
	cols: number,
	rand: () => number,
	opts: { avoidAdjacentPairs?: boolean } = {}
): string[] {
	const avoid = opts.avoidAdjacentPairs ?? true;
	if (objectIds.length * 2 !== rows * cols) {
		throw new Error(`board ${rows}x${cols} needs ${(rows * cols) / 2} objects, got ${objectIds.length}`);
	}
	if (new Set(objectIds).size !== objectIds.length) throw new Error('duplicate object ids');
	const deck = objectIds.flatMap((id) => [id, id]);
	for (let attempt = 0; attempt < 10000; attempt++) {
		const cards = shuffle(deck, rand);
		if (!avoid || !hasAdjacentPair(cards, cols)) return cards;
	}
	throw new Error('could not find a layout without adjacent pairs');
}

export interface BoardDims {
	rows: number;
	cols: number;
}

export interface ColorOption {
	id: string;
	label: string;
	hex: string;
}

export interface OrientationOption {
	id: string;
	label: string;
	rotate_deg: number;
}

export interface PhaseText {
	title: string;
	body: string;
}

export interface ExperimentConfig {
	conditions: string[];
	theme_orders: string[][];
	board: BoardDims;
	practice_board: BoardDims & { theme: string };
	preview_s: number;
	mismatch_flip_ms: number;
	max_participants: number;
	/** Question types. "objects" (the recognition grid) is asked first in each theme block. */
	sa_questions: SaQuestionType[];
	/**
	 * Number of single-item questions per theme after the grid. Types are spread as evenly
	 * as possible over the non-grid types in sa_questions; items and order are random.
	 * Omit to ask every type about every seen object.
	 */
	sa_random_per_theme?: number;
	/** Foils shown in the recognition grid per theme (random subset). Omit to show every foil. */
	sa_foils_per_theme?: number;
	/** Points on the confidence scale; 0 turns the confidence rating off. */
	confidence_scale: number;
	confidence_labels?: [string, string];
	colors: ColorOption[];
	orientations: OrientationOption[];
	condition_text: Record<string, { interval1: PhaseText; interval2: PhaseText }>;
	/**
	 * Situation-awareness questions about the environment, read aloud by the facilitator
	 * after the on-screen questions. The facilitator taps the participant's answer.
	 */
	oral_sa_questions?: OralQuestion[];
}

export interface OralQuestion {
	id: string;
	/** What the facilitator reads aloud. */
	prompt: string;
	options: { id: string; label: string }[];
	/** id of the correct option. */
	answer: string;
}

/** Answers every single-item question offers besides its normal options. Scored as incorrect / excluded. */
export const DONT_REMEMBER = 'dont_remember';
/** Color questions only: excluded from color accuracy. */
export const COLOR_BLIND = 'color_blind';

export type SaQuestionType = 'objects' | 'color' | 'orientation' | 'side_by_side';

/** How the altered variant differs from the original. Any combination is allowed. */
export interface VariantSpec {
	/** Replacement image file (e.g. with a small element removed). */
	image?: string;
	/** Mirror horizontally (in the object's own frame, before rotation). */
	mirror?: boolean;
	/** Uniform scale factor, e.g. 0.85. */
	scale?: number;
	/** Hue rotation applied to the object's color, in degrees. */
	color_shift_deg?: number;
}

export interface ManifestItem {
	id: string;
	label: string;
	/** Image file. With render "mask" (default) it must be a single-color shape and is filled with `color`. */
	image?: string;
	/**
	 * "mask" (default): the image is a silhouette recolored with `color`.
	 * "original": the image (full-color SVG/PNG/JPG or photo) is shown as-is; it is never
	 * asked about in color questions and its variant cannot use color_shift_deg.
	 */
	render?: 'mask' | 'original';
	/** Alternative to `image`: a plain emoji, drawn as-is (practice board only; no color/orientation control). */
	emoji?: string;
	color?: string;
	orientation?: string;
	variant?: VariantSpec;
}

export interface ThemeManifest {
	theme: string;
	label?: string;
	objects: ManifestItem[];
	foils: ManifestItem[];
}

export interface ThemeLayout {
	rows: number;
	cols: number;
	/** Object id for each card position, row-major. */
	cards: string[];
}

export interface LayoutsFile {
	seed: number;
	generated_at: string;
	layouts: Record<string, ThemeLayout>;
}

export interface ScheduleRow {
	pid: string;
	condition: string;
	board_a_theme: string;
	board_b_theme: string;
	seed: number;
}

export type ClickOutcome = 'first_flip' | 'match' | 'mismatch';

export interface ClickRecord {
	seq: number;
	card_index: number;
	object_id: string;
	outcome: ClickOutcome;
	client_ts: number;
}

/** Phases in session order. Interval phases are exercise or rest depending on condition. */
export const PHASES = [
	'baseline',
	'practice',
	'interval1',
	'board_a',
	'interval2',
	'board_b',
	'sa',
	'survey',
	'done'
] as const;
export type Phase = (typeof PHASES)[number];

/** Phases that only the facilitator (keyboard shortcut) can advance out of. */
export const FACILITATOR_PHASES: readonly Phase[] = ['baseline', 'practice', 'interval1', 'interval2'];

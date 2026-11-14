import type { SaStep } from './sa-plan';
import type { ClickRecord, OralQuestion, ColorOption, OrientationOption, Phase, PhaseText, ThemeManifest } from './types';

export interface BoardInfo {
	key: 'practice' | 'A' | 'B';
	theme: string;
	rows: number;
	cols: number;
	cards: string[];
}

/** Everything the participant page needs; returned by GET /api/session. */
export interface SessionState {
	pid: string;
	condition: string;
	phase: Phase;
	phaseStartedAt: number;
	serverNow: number;
	devTimers: boolean;
	/** Admin-created test session: shows the developer toolbar; excluded from exports. */
	isTest: boolean;
	timers: { preview_ms: number; mismatch_flip_ms: number; time_limit_ms: number; interval_ms: { interval1: number; interval2: number } };
	/** This participant's condition records RPE at the end of each bout. */
	recordRpe: boolean;
	text: { interval1: PhaseText; interval2: PhaseText };
	colors: ColorOption[];
	orientations: OrientationOption[];
	confidenceScale: number;
	confidenceLabels: [string, string];
	oralQuestions: OralQuestion[];
	/** Neutral color for Level 2 color-pair options. */
	level2Hex: string;
	manifests: Record<string, ThemeManifest>;
	boards: { practice: BoardInfo; A: BoardInfo; B: BoardInfo };
	/** Progress within the current phase, for resuming after a reload. */
	progress: {
		/** Markers recorded in the current phase (server ms). */
		markers: { name: string; at: number }[];
		clicks: ClickRecord[];
		saAnswered: number;
		/** RPE / peak HR already entered for the current exercise/rest bout. */
		bout: { rpe: number; peak_hr: number | null } | null;
	};
	saPlan: SaStep[];
}

import type { ColorOption, ManifestItem, OrientationOption, VariantSpec } from './types';

export interface RenderSpec {
	/** Mask image URL; absent for emoji items. */
	src?: string;
	emoji?: string;
	/** Draw the image as-is (no recoloring). */
	original?: boolean;
	hex: string;
	transform: string;
}

export function assetUrl(theme: string, file: string): string {
	return `/assets/themes/${encodeURIComponent(theme)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function hexToHsl(hex: string): [number, number, number] {
	const n = parseInt(hex.replace('#', ''), 16);
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function shiftHue(hex: string, deg: number): string {
	const [h, s, l] = hexToHsl(hex);
	return hslToHex((((h + deg) % 360) + 360) % 360, s, l);
}

/**
 * Resolve how an object is drawn: the SVG is used as a CSS mask filled with the
 * assigned color, then rotated to the assigned orientation. Overrides let the SA
 * questions show the same object in other colors/orientations.
 */
export function renderSpec(
	theme: string,
	item: ManifestItem,
	colors: ColorOption[],
	orientations: OrientationOption[],
	/** hex: draw in this exact color (e.g. the neutral gray of Level 2 options), overriding color. */
	opts: { variant?: boolean; color?: string; orientation?: string; hex?: string } = {}
): RenderSpec {
	if (item.emoji) return { emoji: item.emoji, hex: 'inherit', transform: 'none' };
	const color = colors.find((c) => c.id === (opts.color ?? item.color));
	const orient = orientations.find((o) => o.id === (opts.orientation ?? item.orientation));
	const v: VariantSpec = opts.variant ? (item.variant ?? {}) : {};
	let hex = opts.hex ?? color?.hex ?? '#000000';
	if (v.color_shift_deg && !opts.hex) hex = shiftHue(hex, v.color_shift_deg);
	const parts = [`rotate(${orient?.rotate_deg ?? 0}deg)`];
	if (v.scale) parts.push(`scale(${v.scale})`);
	if (v.mirror) parts.push('scaleX(-1)');
	const src = assetUrl(theme, v.image ?? item.image ?? '');
	if (item.render === 'original') return { src, original: true, hex: 'transparent', transform: parts.join(' ') };
	return { src, hex, transform: parts.join(' ') };
}

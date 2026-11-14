/**
 * Copy icons out of the bundled open-licensed icon sets into the theme folders.
 * Runs offline (the sets are npm dev dependencies). Existing files are left alone
 * unless --force is given, so hand-supplied images are never overwritten.
 *
 *   npm run icons [-- --force]
 *
 * Sources: Material Design Icons (mdi, Apache-2.0), game-icons.net (gi, CC BY 3.0).
 * See assets/ATTRIBUTION.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { paths } from '../src/lib/server/files';
import type { ThemeManifest } from '../src/lib/types';
import { flag } from './cli';

const require = createRequire(import.meta.url);
type IconSet = { width?: number; height?: number; icons: Record<string, { body: string; width?: number; height?: number }> };
const SETS: Record<string, IconSet> = {
	mdi: require('@iconify-json/mdi/icons.json'),
	gi: require('@iconify-json/game-icons/icons.json')
};

/** manifest item id -> "set:icon" */
export const ICON_MAP: Record<string, string> = {
	// transport
	train: 'mdi:train',
	plane: 'mdi:airplane',
	car: 'mdi:car-side',
	boat: 'mdi:ferry',
	bike: 'mdi:bicycle',
	scooter: 'mdi:scooter',
	helicopter: 'mdi:helicopter',
	rocket: 'mdi:rocket',
	bus: 'mdi:bus-side',
	tram: 'mdi:tram-side',
	motorcycle: 'mdi:motorbike',
	truck: 'mdi:truck',
	submarine: 'mdi:submarine',
	hot_air_balloon: 'mdi:airballoon',
	skateboard: 'mdi:skateboard',
	tractor: 'mdi:tractor',
	// MIT. Not listed (hand-supplied, never overwritten): mit_logo (Wikimedia), muddy_charles (Twemoji),
	// boston_skyline / stata_center / green_building (photos), infinite_corridor (composed doorway + infinity),
	// apollo_capsule_variant.svg, integral (MathJax). Transport: helicopter_variant.svg and
	// rocket_variant.svg (hand-drawn additions). See assets/ATTRIBUTION.md.
	beaver: 'gi:beaver',
	great_dome: 'gi:capitol',
	dna_helix: 'mdi:dna',
	apollo_capsule: 'gi:apollo-capsule',
	boston_skyline: 'gi:modern-city',
	kresge_auditorium: 'gi:theater',
	harvard_bridge: 'mdi:bridge',
	brass_rat: 'gi:diamond-ring',
	killian_court: 'mdi:school',
	sailing_pavilion: 'mdi:sail-boat'
};

export function iconSvg(ref: string): string {
	const [set, name] = ref.split(':');
	const s = SETS[set];
	const icon = s?.icons[name];
	if (!icon) throw new Error(`unknown icon ${ref}`);
	const w = icon.width ?? s.width ?? 24;
	const h = icon.height ?? s.height ?? 24;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 4}" height="${h * 4}"><!-- ${ref} -->${icon.body}</svg>\n`;
}

const force = flag('force');
const themesDir = path.join(paths.assets, 'themes');
let written = 0;
let kept = 0;
for (const theme of fs.readdirSync(themesDir)) {
	const mf = path.join(themesDir, theme, 'manifest.json');
	if (!fs.existsSync(mf)) continue;
	const m: ThemeManifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
	for (const item of [...m.objects, ...m.foils]) {
		if (!item.image || item.render === 'original' || !item.image.endsWith('.svg')) continue;
		const ref = ICON_MAP[item.id];
		const file = path.join(themesDir, theme, item.image);
		if (!ref) {
			if (!fs.existsSync(file)) console.warn(`no icon for ${theme}/${item.id}; supply ${item.image} yourself`);
			continue;
		}
		if (fs.existsSync(file) && !force) {
			kept++;
			continue;
		}
		fs.writeFileSync(file, iconSvg(ref));
		written++;
	}
}
console.log(`icons: wrote ${written}, kept ${kept} existing${force ? '' : ' (use --force to overwrite)'}`);

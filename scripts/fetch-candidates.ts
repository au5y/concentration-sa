/**
 * Download alternative icons/images for every board object and foil into
 * assets/candidates/<theme>/<id>/, for review on the /preview page.
 * Needs network access (run once on a dev machine, not at study time).
 *
 *   npm run candidates [-- --force] [-- --only mit]
 *
 * Sources:
 *  - Iconify API (https://api.iconify.design): single-color sets (usable as colored masks)
 *    and full-color emoji sets (shown as-is). Licenses are recorded per file.
 *  - Wikimedia Commons: photo thumbnails for named places (shown as-is).
 * Each candidate gets an entry in assets/candidates/index.json with source + license.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../src/lib/server/files';
import type { ThemeManifest } from '../src/lib/types';
import { arg, flag } from './cli';

const UA = 'concentration-sa-preview/1.0 (research study asset review)';
const MONO_SETS = ['mdi', 'game-icons', 'material-symbols', 'ph', 'tabler', 'fa6-solid', 'icon-park-solid', 'healthicons'];
const COLOR_SETS = ['fluent-emoji-flat', 'noto', 'twemoji', 'openmoji'];

/** Search terms per item. `photo` = Commons search; omitted means no photo candidates. */
const QUERIES: Record<string, { icon: string[]; photo?: string }> = {
	// MIT
	beaver: { icon: ['beaver'], photo: 'Tim the Beaver MIT mascot' },
	great_dome: { icon: ['dome', 'capitol', 'columns'], photo: 'Great Dome MIT' },
	dna_helix: { icon: ['dna'] },
	apollo_capsule: { icon: ['capsule space', 'apollo', 'space capsule'], photo: 'Apollo command module' },
	mit_logo: { icon: [] },
	muddy_charles: { icon: ['beer mug', 'pub', 'beer'] },
	boston_skyline: { icon: ['city skyline', 'cityscape', 'skyline'], photo: 'Boston skyline from Cambridge' },
	integral: { icon: ['integral', 'function'] },
	stata_center: { icon: ['modern building'], photo: 'Stata Center MIT' },
	green_building: { icon: ['office building', 'skyscraper'], photo: 'Green Building MIT' },
	kresge_auditorium: { icon: ['theater', 'auditorium'], photo: 'Kresge Auditorium MIT' },
	harvard_bridge: { icon: ['bridge'], photo: 'Harvard Bridge Boston' },
	brass_rat: { icon: ['ring', 'class ring'], photo: 'MIT Brass Rat ring' },
	infinite_corridor: { icon: ['corridor', 'hallway', 'door'], photo: 'Infinite Corridor MIT' },
	killian_court: { icon: ['school', 'university', 'graduation'], photo: 'Killian Court MIT' },
	sailing_pavilion: { icon: ['sailboat', 'sailing'], photo: 'MIT Sailing Pavilion' },
	// transport
	train: { icon: ['train', 'locomotive'] },
	plane: { icon: ['airplane'] },
	car: { icon: ['car'] },
	boat: { icon: ['ferry', 'ship'] },
	bike: { icon: ['bicycle'] },
	scooter: { icon: ['kick scooter', 'scooter'] },
	helicopter: { icon: ['helicopter'] },
	rocket: { icon: ['rocket'] },
	bus: { icon: ['bus'] },
	tram: { icon: ['tram'] },
	motorcycle: { icon: ['motorcycle'] },
	truck: { icon: ['truck'] },
	submarine: { icon: ['submarine'] },
	hot_air_balloon: { icon: ['hot air balloon', 'balloon'] },
	skateboard: { icon: ['skateboard'] },
	tractor: { icon: ['tractor'] }
};

export interface Candidate {
	file: string;
	/** "mask" = single-color shape (can be recolored); "original" = shown as-is. */
	render: 'mask' | 'original';
	source: string;
	license: string;
	author?: string;
	url?: string;
}
export type CandidateIndex = Record<string, Record<string, Candidate[]>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Download one icon; the API sometimes answers with an HTML error page, so check and retry. */
export async function fetchSvg(prefix: string, name: string): Promise<string | null> {
	for (let i = 0; i < 5; i++) {
		const r = await fetch(`https://api.iconify.design/${prefix}/${name}.svg?height=96`, { headers: { 'user-agent': UA } });
		const text = r.ok ? await r.text() : '';
		if (text.trimStart().startsWith('<svg')) return text;
		await sleep(1000 * 2 ** i);
	}
	return null;
}

async function json<T>(url: string): Promise<T> {
	const r = await fetch(url, { headers: { 'user-agent': UA } });
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return r.json() as Promise<T>;
}

const collections = new Map<string, { license?: { title?: string }; author?: { name?: string } }>();
async function collectionInfo(prefix: string) {
	if (!collections.has(prefix)) {
		const r = await json<Record<string, { license?: { title?: string }; author?: { name?: string } }>>(
			`https://api.iconify.design/collections?prefixes=${prefix}`
		);
		collections.set(prefix, r[prefix] ?? {});
	}
	return collections.get(prefix)!;
}

async function iconCandidates(terms: string[], sets: string[], max: number): Promise<string[]> {
	const found: string[] = [];
	for (const term of terms) {
		const r = await json<{ icons: string[] }>(
			`https://api.iconify.design/search?query=${encodeURIComponent(term)}&limit=64&prefixes=${sets.join(',')}`
		);
		for (const ic of r.icons) {
			const set = ic.split(':')[0];
			// One per set per item keeps the choice varied.
			if (!found.includes(ic) && !found.some((f) => f.split(':')[0] === set)) found.push(ic);
			if (found.length >= max) return found;
		}
	}
	return found;
}

async function commonsPhotos(query: string, max: number) {
	const api = 'https://commons.wikimedia.org/w/api.php';
	const q = new URLSearchParams({
		action: 'query',
		format: 'json',
		generator: 'search',
		gsrsearch: `${query} filetype:bitmap`,
		gsrnamespace: '6',
		gsrlimit: String(max * 3),
		prop: 'imageinfo',
		iiprop: 'url|extmetadata|mime',
		iiurlwidth: '480'
	});
	const r = await json<{ query?: { pages: Record<string, any> } }>(`${api}?${q}`);
	const pages = Object.values(r.query?.pages ?? {}).sort((a: any, b: any) => a.index - b.index);
	const out: { thumb: string; page: string; license: string; author: string }[] = [];
	for (const p of pages) {
		const ii = p.imageinfo?.[0];
		if (!ii?.thumburl || !/jpeg|png/.test(ii.mime)) continue;
		const md = ii.extmetadata ?? {};
		const license = md.LicenseShortName?.value ?? 'unknown';
		if (!/public domain|cc0|cc by|cc-by|pd/i.test(license)) continue;
		const author = String(md.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim();
		out.push({ thumb: ii.thumburl, page: ii.descriptionurl, license, author });
		if (out.length >= max) break;
	}
	return out;
}

const force = flag('force');
const only = arg('only');
const root = path.join(paths.assets, 'candidates');
const indexFile = path.join(root, 'index.json');
const index: CandidateIndex = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};

for (const theme of fs.readdirSync(path.join(paths.assets, 'themes'))) {
	if (only && theme !== only) continue;
	const mf = path.join(paths.themeDir(theme), 'manifest.json');
	if (!fs.existsSync(mf)) continue;
	const m: ThemeManifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
	index[theme] ??= {};
	for (const item of [...m.objects, ...m.foils]) {
		const q = QUERIES[item.id];
		if (!q || item.emoji) continue;
		if (index[theme][item.id]?.length && !force) continue;
		const dir = path.join(root, theme, item.id);
		fs.mkdirSync(dir, { recursive: true });
		const list: Candidate[] = [];
		try {
			for (const [sets, render, max] of [
				[MONO_SETS, 'mask', 5],
				[COLOR_SETS, 'original', 3]
			] as const) {
				for (const ic of await iconCandidates(q.icon, [...sets], max)) {
					const [prefix, name] = ic.split(':');
					const svg = await fetchSvg(prefix, name);
					if (!svg) {
						console.warn(`${theme}/${item.id}: could not download ${ic}`);
						continue;
					}
					const file = `${prefix}--${name}.svg`;
					fs.writeFileSync(path.join(dir, file), svg);
					const info = await collectionInfo(prefix);
					list.push({
						file,
						render,
						source: `Iconify ${ic}`,
						license: info.license?.title ?? 'see Iconify',
						author: info.author?.name,
						url: `https://icon-sets.iconify.design/${prefix}/?icon-filter=${name}`
					});
				}
			}
			if (q.photo) {
				let i = 0;
				for (const p of await commonsPhotos(q.photo, 3)) {
					const r = await fetch(p.thumb, { headers: { 'user-agent': UA } });
					if (!r.ok) continue;
					const ext = p.thumb.toLowerCase().includes('.png') ? 'png' : 'jpg';
					const file = `photo-${++i}.${ext}`;
					fs.writeFileSync(path.join(dir, file), Buffer.from(await r.arrayBuffer()));
					list.push({ file, render: 'original', source: 'Wikimedia Commons', license: p.license, author: p.author, url: p.page });
				}
			}
		} catch (e) {
			console.warn(`${theme}/${item.id}: ${(e as Error).message}`);
		}
		index[theme][item.id] = list;
		console.log(`${theme}/${item.id}: ${list.length} candidates`);
	}
}
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(indexFile, JSON.stringify(index, null, '\t') + '\n');
console.log(`wrote ${indexFile}`);

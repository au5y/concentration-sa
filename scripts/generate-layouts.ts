/**
 * Generate the fixed card layouts (same for every participant) for every theme
 * in the config, writing <assets>/layouts.json.
 *
 *   npm run layouts -- [--seed 1234] [--force]
 */
import fs from 'node:fs';
import { generateLayout } from '../src/lib/layout';
import { hashString, mulberry32, randomSeed } from '../src/lib/rng';
import { loadConfig, loadManifests, paths } from '../src/lib/server/files';
import type { LayoutsFile } from '../src/lib/types';
import { experimentThemes } from '../src/lib/validate';
import { arg, flag } from './cli';

const config = loadConfig(arg('config') ?? paths.config);
const manifests = loadManifests(config);
const seed = arg('seed') !== undefined ? Number(arg('seed')) : randomSeed();

if (fs.existsSync(paths.layouts) && !flag('force')) {
	console.error(`${paths.layouts} already exists. Layouts must stay fixed once data collection starts; use --force to regenerate.`);
	process.exit(1);
}

const { sa, practice } = experimentThemes(config);
const out: LayoutsFile = { seed, generated_at: new Date().toISOString(), layouts: {} };
for (const theme of [...sa, practice]) {
	const m = manifests[theme];
	if (!m) throw new Error(`missing manifest for theme ${theme}`);
	const dims = theme === practice ? config.practice_board : config.board;
	const rand = mulberry32(seed ^ hashString(theme));
	out.layouts[theme] = { rows: dims.rows, cols: dims.cols, cards: generateLayout(m.objects.map((o) => o.id), dims.rows, dims.cols, rand) };
}
fs.writeFileSync(paths.layouts, JSON.stringify(out, null, '\t') + '\n');
console.log(`wrote ${paths.layouts} (seed ${seed})`);
for (const [t, l] of Object.entries(out.layouts)) {
	console.log(`\n${t}:`);
	for (let r = 0; r < l.rows; r++) console.log('  ' + l.cards.slice(r * l.cols, (r + 1) * l.cols).map((c) => c.padEnd(16)).join(''));
}

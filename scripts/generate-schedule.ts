/**
 * Generate the participant schedule (block-randomized condition x theme order).
 *
 *   npm run schedule -- [--seed 1234] [--n 30] [--out data/schedule.csv] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { toCsv } from '../src/lib/csv';
import { randomSeed } from '../src/lib/rng';
import { cellKey, generateSchedule } from '../src/lib/schedule';
import { loadConfig, paths } from '../src/lib/server/files';
import { arg, flag } from './cli';

const config = loadConfig(arg('config') ?? paths.config);
const seed = arg('seed') !== undefined ? Number(arg('seed')) : randomSeed();
const n = Number(arg('n') ?? config.max_participants);
const out = path.resolve(arg('out') ?? paths.schedule);

if (!Number.isInteger(seed) || !Number.isInteger(n) || n < 1) {
	console.error('--seed and --n must be integers');
	process.exit(1);
}
if (fs.existsSync(out) && !flag('force')) {
	console.error(`${out} already exists. Re-run with --force to overwrite (this re-randomizes everyone!).`);
	process.exit(1);
}

const rows = generateSchedule({ conditions: config.conditions, theme_orders: config.theme_orders, n, seed });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toCsv(rows as unknown as Record<string, unknown>[], ['pid', 'condition', 'board_a_theme', 'board_b_theme', 'seed']));

const counts = new Map<string, number>();
for (const r of rows) counts.set(cellKey(r), (counts.get(cellKey(r)) ?? 0) + 1);
console.log(`wrote ${rows.length} participants to ${out} (seed ${seed})`);
for (const [k, v] of counts) console.log(`  ${k.padEnd(32)} ${v}`);

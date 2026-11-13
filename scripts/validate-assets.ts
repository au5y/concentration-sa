/** Check config, manifests, images and layouts. Exits non-zero on problems.  npm run validate */
import { loadConfig, loadLayouts, loadManifests, paths, themeFileExists } from '../src/lib/server/files';
import { experimentWarnings, validateExperiment } from '../src/lib/validate';

const config = loadConfig();
for (const w of experimentWarnings(config)) console.warn('warning: ' + w);
const errs = validateExperiment(config, loadManifests(config), loadLayouts(), themeFileExists);
if (errs.length) {
	console.error(`${errs.length} problem(s) (config ${paths.config}, assets ${paths.assets}):`);
	for (const e of errs) console.error('  - ' + e);
	process.exit(1);
}
console.log('config, manifests, images and layouts look good');

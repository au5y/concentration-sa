import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '$lib/server/files';

const TYPES: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

/** Serve theme images from ASSETS_DIR at request time so files can be swapped without a rebuild. */
export function GET({ params }) {
	const dir = paths.themeDir(params.theme);
	const full = path.resolve(dir, params.file);
	const type = TYPES[path.extname(full).toLowerCase()];
	if (!full.startsWith(dir + path.sep) || !type || !fs.existsSync(full)) error(404, 'not found');
	return new Response(fs.readFileSync(full), {
		headers: { 'content-type': type, 'cache-control': 'no-cache' }
	});
}

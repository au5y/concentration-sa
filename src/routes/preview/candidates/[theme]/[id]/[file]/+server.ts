import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { candidatesDir } from '$lib/server/preview';

const TYPES: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp'
};

/** Serve candidate images from assets/candidates (preview page only). */
export function GET({ params }) {
	const dir = candidatesDir();
	const full = path.resolve(dir, params.theme, params.id, params.file);
	const type = TYPES[path.extname(full).toLowerCase()];
	if (!full.startsWith(dir + path.sep) || !type || !fs.existsSync(full)) error(404, 'not found');
	return new Response(fs.readFileSync(full), { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
}

/**
 * Suggested tags offered when editing a participant on the admin page. Edited at the bottom of
 * the admin page and stored in DATA_DIR/tags.json; a session can still get any other tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanTags } from './edit';
import { paths } from './files';

export const DEFAULT_TAG_PRESETS = [
	'stairs',
	'burpees',
	'late start',
	'interrupted',
	'page reloaded',
	'HR strap issue',
	'target HR not reached',
	'instructions repeated',
	'exclude'
];

const file = () => path.join(paths.data, 'tags.json');

export function getTagPresets(): string[] {
	try {
		const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
		if (Array.isArray(saved) && saved.every((t) => typeof t === 'string')) return saved;
	} catch {
		// not saved yet
	}
	return DEFAULT_TAG_PRESETS;
}

export function saveTagPresets(tags: unknown): string[] {
	const out = cleanTags(tags, 40);
	fs.mkdirSync(paths.data, { recursive: true });
	fs.writeFileSync(file(), JSON.stringify(out, null, 2));
	return out;
}

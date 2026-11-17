/**
 * The public front page (/): study title, text, sign-up links and contact address. Edited on the
 * admin page and stored in DATA_DIR/landing.json, so a new round of the study (new people, new
 * times, new booking pages) needs no code change.
 */
import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import type { Landing } from '../landing';
import { paths } from './files';

export type { Landing, LandingLink } from '../landing';

export const DEFAULT_LANDING: Landing = {
	title: 'Pump Up the Memory',
	body:
		'An MIT study on exercise, rest and memory. A session takes about 20 minutes.\n\n' +
		"What you'll do:\n• Wear a heart-rate chest strap during the session\n• Do a short period of light exercise or rest\n" +
		'• Play two short memory card games on a laptop\n• Answer a few questions afterwards\n\n' +
		'Please wear comfortable clothes and shoes you can move in.',
	links: [],
	closed: 'Sign-ups are not open right now. Email us to hear about the next session.',
	contact: 'pump-up-the-memory@mit.edu'
};

const file = () => path.join(paths.data, 'landing.json');

export function getLanding(): Landing {
	try {
		return { ...DEFAULT_LANDING, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
	} catch {
		return DEFAULT_LANDING;
	}
}

const text = (v: unknown, name: string, max: number) => {
	if (typeof v !== 'string' || v.length > max) error(400, `${name} must be text of at most ${max} characters`);
	return v.trim();
};

export function saveLanding(v: Record<string, unknown>): Landing {
	if (!Array.isArray(v.links) || v.links.length > 10) error(400, 'links must be a list of at most 10');
	const links = v.links
		.map((l: Record<string, unknown>, i: number) => ({ label: text(l?.label, `link ${i + 1} label`, 100), url: text(l?.url, `link ${i + 1} URL`, 2000) }))
		.filter((l) => l.label || l.url);
	for (const l of links) {
		if (!l.label) error(400, `Link ${l.url} needs a label`);
		let u: URL;
		try {
			u = new URL(l.url);
		} catch {
			error(400, `"${l.url}" is not a web address`);
		}
		if (u.protocol !== 'https:') error(400, `"${l.url}" must start with https://`);
	}
	const contact = text(v.contact, 'contact', 200);
	if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) error(400, 'contact must be an email address');
	const out: Landing = {
		title: text(v.title, 'title', 200) || DEFAULT_LANDING.title,
		body: text(v.body, 'text', 5000),
		links,
		closed: text(v.closed, 'closed message', 500),
		contact
	};
	fs.mkdirSync(paths.data, { recursive: true });
	fs.writeFileSync(file(), JSON.stringify(out, null, 2));
	return out;
}

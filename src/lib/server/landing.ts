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

export type { Landing, LandingFact, LandingLink } from '../landing';

export const DEFAULT_LANDING: Landing = {
	kicker: 'MIT Student Study',
	tag: 'Exercise + Attention',
	title: 'Step Up',
	titleAccent: 'Your Game',
	intro:
		'Raise your heart rate (or rest!), play two short computer matching games and answer some quick questions. ' +
		'Between games, some people climb stairs at their own pace; others rest. Groups are assigned at random.',
	facts: [
		{ label: 'Time', text: 'About 20 minutes, one visit' },
		{ label: 'Who', text: 'Adults 18+ who can climb stairs for a few minutes. No known heart conditions. Able to tell red, green, yellow and blue apart.' },
		{ label: 'Wear', text: 'Comfortable shoes and exercise clothes' },
		{ label: 'Note', text: 'You can stop at any time' }
	],
	date: '',
	links: [],
	signupNote: 'Sessions start every 15 minutes. Two people can run at the same time, so bring a friend.',
	closed: 'Sign-ups are not open right now. Email us to hear about the next session.',
	contact: 'pump-up-the-memory@mit.edu'
};

const file = () => path.join(paths.data, 'landing.json');

export function getLanding(): Landing {
	try {
		const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
		// Pages saved before the flier redesign had `body` instead of `intro`.
		if (typeof saved.body === 'string' && saved.intro === undefined) saved.intro = saved.body;
		delete saved.body;
		return { ...DEFAULT_LANDING, ...saved };
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
	if (!Array.isArray(v.facts) || v.facts.length > 8) error(400, 'facts must be a list of at most 8');
	const facts = v.facts
		.map((f: Record<string, unknown>, i: number) => ({ label: text(f?.label, `row ${i + 1} label`, 40), text: text(f?.text, `row ${i + 1} text`, 500) }))
		.filter((f) => f.label || f.text);
	const contact = text(v.contact, 'contact', 200);
	if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) error(400, 'contact must be an email address');
	const out: Landing = {
		kicker: text(v.kicker, 'top-left line', 80),
		tag: text(v.tag, 'top-right line', 80),
		title: text(v.title, 'title', 80) || DEFAULT_LANDING.title,
		titleAccent: text(v.titleAccent, 'title line 2', 80),
		intro: text(v.intro, 'intro', 5000),
		facts,
		date: text(v.date, 'date', 200),
		links,
		signupNote: text(v.signupNote, 'sign-up note', 500),
		closed: text(v.closed, 'closed message', 500),
		contact
	};
	fs.mkdirSync(paths.data, { recursive: true });
	fs.writeFileSync(file(), JSON.stringify(out, null, 2));
	return out;
}

/** The /run password gate and the editable front page. Uses a throwaway DATA_DIR. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
let access: typeof import('../src/lib/server/access');
let admin: typeof import('../src/lib/server/admin');
let landing: typeof import('../src/lib/server/landing');

/** Minimal cookie jar standing in for SvelteKit's. */
function jar(): Cookies & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		get: (n: string) => store.get(n),
		set: (n: string, v: string) => void store.set(n, v),
		delete: (n: string) => void store.delete(n)
	} as unknown as Cookies & { store: Map<string, string> };
}

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-access-'));
	process.env.DATA_DIR = dir;
	access = await import('../src/lib/server/access');
	admin = await import('../src/lib/server/admin');
	landing = await import('../src/lib/server/landing');
});
afterEach(() => {
	delete process.env.RUN_PASSWORD;
	delete process.env.ADMIN_PASSWORD;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('run password', () => {
	it('is open when no password is set (local development)', () => {
		expect(access.canRun(jar())).toBe(true);
	});

	it('takes the run password or the admin password, and nothing else', () => {
		process.env.ADMIN_PASSWORD = 'admin-pw';
		process.env.RUN_PASSWORD = 'study-pw';
		const c = jar();
		expect(access.canRun(c)).toBe(false);
		expect(access.runLogin(c, 'nope')).toBe(false);
		expect(access.canRun(c)).toBe(false);
		expect(access.runLogin(c, 'study-pw')).toBe(true);
		expect(access.canRun(c)).toBe(true);
		const c2 = jar();
		expect(access.runLogin(c2, 'admin-pw')).toBe(true);
		expect(access.canRun(c2)).toBe(true);
		// a run login is not an admin login
		expect(admin.isAdmin(c)).toBe(false);
		// a forged cookie fails
		const c3 = jar();
		c3.store.set('run_token', 'x'.repeat(64));
		expect(access.canRun(c3)).toBe(false);
	});

	it('lets an admin run sessions without the run password', () => {
		process.env.ADMIN_PASSWORD = 'admin-pw';
		process.env.RUN_PASSWORD = 'study-pw';
		const c = jar();
		expect(admin.login(c, 'admin-pw')).toBe(true);
		expect(access.canRun(c)).toBe(true);
	});

	it('logs out every laptop when the password changes', () => {
		process.env.RUN_PASSWORD = 'old';
		const c = jar();
		access.runLogin(c, 'old');
		process.env.RUN_PASSWORD = 'new';
		expect(access.canRun(c)).toBe(false);
	});

	it('gates the session data and game images, not the front page', () => {
		for (const p of ['/api/session', '/api/session/click', '/assets/themes/mit/beaver.svg']) expect(access.isRunGated(p)).toBe(true);
		for (const p of ['/', '/run', '/run/auth', '/admin', '/api/sessions-x', '/assets/other']) expect(access.isRunGated(p)).toBe(false);
	});
});

describe('front page', () => {
	it('starts from the defaults with sign-ups closed', () => {
		expect(landing.getLanding()).toEqual(landing.DEFAULT_LANDING);
		expect(landing.getLanding().links).toEqual([]);
	});

	it('saves links and text to DATA_DIR, dropping empty link rows', () => {
		const saved = landing.saveLanding({
			title: ' Round 2 ',
			body: 'Hello',
			links: [
				{ label: 'Seat A', url: 'https://calendar.app.google/abc' },
				{ label: '', url: '' }
			],
			closed: 'Closed',
			contact: 'study@mit.edu'
		});
		expect(saved.title).toBe('Round 2');
		expect(saved.links).toEqual([{ label: 'Seat A', url: 'https://calendar.app.google/abc' }]);
		expect(landing.getLanding()).toEqual(saved);
		expect(JSON.parse(fs.readFileSync(path.join(dir, 'landing.json'), 'utf8'))).toEqual(saved);
	});

	it('rejects unsafe or broken links and bad emails', () => {
		const base = { title: 't', body: '', closed: '', contact: '' };
		const bad = (v: Record<string, unknown>) => expect(() => landing.saveLanding({ ...base, ...v })).toThrow();
		bad({ links: [{ label: 'x', url: 'javascript:alert(1)' }] });
		bad({ links: [{ label: 'x', url: 'http://example.com' }] });
		bad({ links: [{ label: 'x', url: 'not a url' }] });
		bad({ links: [{ label: '', url: 'https://example.com' }] });
		bad({ links: 'nope' });
		bad({ links: [], contact: 'not-an-email' });
	});
});

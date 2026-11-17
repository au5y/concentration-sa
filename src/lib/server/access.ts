/**
 * Who may run sessions: the study pages (/run) and the data they send (/api/session, the game
 * images under /assets/themes) need either the admin login or the run password. RUN_PASSWORD is
 * for facilitators who shouldn't have admin; the admin password also works at /run. With neither
 * set (local development) everything stays open, as before.
 */
import type { Cookies } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { isAdmin } from './admin';

const COOKIE = 'run_token';
/** A study laptop stays logged in for a week. */
const MAX_AGE_S = 7 * 24 * 60 * 60;

const passwords = () => [process.env.RUN_PASSWORD, process.env.ADMIN_PASSWORD].filter((p): p is string => !!p);
export const runLocked = () => passwords().length > 0;

function token(): string | null {
	const pw = passwords();
	if (!pw.length) return null;
	return crypto.createHmac('sha256', pw.join('\0')).update('concentration-run').digest('hex');
}

const same = (a: string, b: string) =>
	crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

export function canRun(cookies: Cookies): boolean {
	if (!runLocked() || isAdmin(cookies)) return true;
	const t = token()!;
	const c = cookies.get(COOKIE);
	return !!c && same(c, t);
}

export function runLogin(cookies: Cookies, password: string): boolean {
	if (!passwords().some((p) => same(p, password))) return false;
	cookies.set(COOKIE, token()!, { path: '/', httpOnly: true, sameSite: 'strict', secure: false, maxAge: MAX_AGE_S });
	return true;
}

export function runLogout(cookies: Cookies) {
	cookies.delete(COOKIE, { path: '/', secure: false });
}

/** Paths that need canRun (besides the /run page itself). */
export const RUN_GATED = ['/api/session', '/assets/themes'];
export const isRunGated = (path: string) => RUN_GATED.some((g) => path === g || path.startsWith(`${g}/`));

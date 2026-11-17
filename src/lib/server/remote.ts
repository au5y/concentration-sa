/**
 * Access for remote participants. Each remote participant gets a link with a key (an HMAC of
 * their pid); opening it stores the key in a cookie, which then lets that browser load and
 * play that one session (and send its heart-rate readings) without the study password. The key
 * cannot advance facilitator phases: only a logged-in study laptop or the admin console can.
 */
import { error, type Cookies } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { hasRemoteTag } from '../remote';
import { getDb } from './db';
import { loadSchedule } from './files';
import { canRun } from './access';
import { checkPid } from './http';

const COOKIE = 'remote_token';
const MAX_AGE_S = 14 * 24 * 60 * 60;

function secret(): string {
	return process.env.REMOTE_SECRET || process.env.ADMIN_PASSWORD || process.env.RUN_PASSWORD || 'dev-remote-secret';
}

export function remoteKey(pid: string): string {
	return crypto.createHmac('sha256', secret()).update(`remote:${pid}`).digest('base64url').slice(0, 22);
}

const same = (a: string, b: string) =>
	a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** True if this pid is (or is scheduled to be) a remote participant. */
export function isRemotePid(pid: string): boolean {
	const s = getDb().prepare('SELECT tags FROM sessions WHERE pid = ?').get(pid) as { tags: string } | undefined;
	if (s) return hasRemoteTag(s.tags);
	return loadSchedule().some((r) => r.pid === pid && r.remote);
}

/** Check a ?key= from a participant link and, if it is good, remember it in this browser. */
export function remoteLogin(cookies: Cookies, pid: string, key: string): boolean {
	if (!same(key, remoteKey(pid)) || !isRemotePid(pid)) return false;
	cookies.set(COOKIE, `${pid}.${key}`, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: MAX_AGE_S });
	return true;
}

/** The remote participant this browser is logged in as, or null. */
export function remotePid(cookies: Cookies): string | null {
	const c = cookies.get(COOKIE);
	if (!c) return null;
	const i = c.lastIndexOf('.');
	if (i < 1) return null;
	const pid = c.slice(0, i);
	const key = c.slice(i + 1);
	if (!/^[A-Za-z0-9_-]{1,32}$/.test(pid) || !same(key, remoteKey(pid))) return null;
	return isRemotePid(pid) ? pid : null;
}

/**
 * The pid of a session request, if this browser may use it: a study laptop (run password or
 * admin) may use any, a remote participant's browser only their own.
 */
export function sessionPid(cookies: Cookies, raw: unknown): string {
	const pid = checkPid(raw);
	if (canRun(cookies) || remotePid(cookies) === pid) return pid;
	error(403, `This browser is not allowed to open ${pid}`);
}

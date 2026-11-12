import type { SessionState } from '$lib/state';

/** High-resolution client timestamp in epoch ms (fractional). */
export const nowTs = () => performance.timeOrigin + performance.now();

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		let msg = res.statusText;
		try {
			msg = (await res.json()).message ?? msg;
		} catch {
			/* not JSON */
		}
		throw new ApiError(res.status, msg);
	}
	return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry on network errors and 5xx; give up immediately on 4xx (a real rejection). */
export async function withRetry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if ((e instanceof ApiError && e.status < 500) || i >= tries - 1) throw e;
			await sleep(Math.min(4000, 250 * 2 ** i));
		}
	}
}

/** Serial queue so logged events reach the server in order and survive brief network hiccups. */
class Queue {
	private chain: Promise<unknown> = Promise.resolve();
	pending = 0;
	push<T>(fn: () => Promise<T>): Promise<T> {
		this.pending++;
		const p = this.chain.then(() => withRetry(fn)).finally(() => this.pending--);
		this.chain = p.catch((e) => console.error('logging failed', e));
		return p;
	}
	/** Resolves once everything queued so far has been sent. */
	flush(): Promise<unknown> {
		return this.chain;
	}
}
export const queue = new Queue();

export const api = {
	session: (pid: string) => withRetry(() => request<SessionState>('GET', `/api/session?pid=${encodeURIComponent(pid)}`)),
	advance: async (pid: string, from: string, facilitator = false) => {
		await queue.flush();
		return withRetry(() => request<SessionState>('POST', '/api/session/advance', { pid, from, facilitator, client_ts: nowTs() }));
	},
	mark: (pid: string, phase: string, name: string, client_ts = nowTs()) =>
		queue.push(() => request<{ at: number }>('POST', '/api/session/mark', { pid, phase, name, client_ts })),
	click: (pid: string, c: { board: string; seq: number; card_index: number; outcome: string; client_ts: number }) =>
		queue.push(() => request('POST', '/api/session/click', { pid, ...c })),
	sa: (pid: string, a: Record<string, unknown>) => queue.push(() => request<{ answered: number }>('POST', '/api/session/sa', { pid, ...a })),
	bout: (pid: string, phase: string, rpe: number, peak_hr: number | null) =>
		withRetry(() => request<{ ok: true }>('POST', '/api/session/bout', { pid, phase, rpe, peak_hr })),
	/** Test sessions only; needs the admin login cookie in this browser. */
	jump: async (pid: string, phase: string, fast?: boolean) => {
		await queue.flush();
		return request<SessionState>('POST', '/admin/test', { action: 'jump', pid, phase, fast });
	},
	survey: async (pid: string, v: Record<string, unknown>) => {
		await queue.flush();
		return withRetry(() => request<SessionState>('POST', '/api/session/survey', { pid, ...v, client_ts: nowTs() }));
	}
};

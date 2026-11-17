/**
 * Remote participants ("RP"): they take part from their own computer (Chrome, their own
 * Bluetooth heart-rate strap) while the facilitator watches and moves them through the
 * facilitator-only phases from /admin/remote/<pid>, talking to them over Zoom or the phone.
 * A session is remote when it carries the RP tag; a schedule row before the session starts
 * has `remote` set. Remote sessions skip the environment (oral) SA questions.
 */
export const REMOTE_TAG = 'RP';

export const splitTagList = (tags: string | null | undefined): string[] =>
	(tags ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

export const isRemoteTag = (t: string) => t.toLowerCase() === REMOTE_TAG.toLowerCase();

export const hasRemoteTag = (tags: string | string[] | null | undefined): boolean =>
	(Array.isArray(tags) ? tags : splitTagList(tags)).some(isRemoteTag);

/** The participant's own link: opens their session on any computer, no study password needed. */
export const remotePath = (pid: string, key: string) => `/run?pid=${encodeURIComponent(pid)}&key=${encodeURIComponent(key)}`;

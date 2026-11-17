import { error, json } from '@sveltejs/kit';
import { sessionPid } from '$lib/server/remote';
import { body } from '$lib/server/http';
import { recordClick } from '$lib/server/session';

export async function POST({ request, cookies }) {
	const b = await body(request);
	const pid = sessionPid(cookies, b.pid);
	if (b.board !== 'A' && b.board !== 'B') error(400, 'bad board');
	recordClick(pid, { board: b.board, seq: b.seq, card_index: b.card_index, outcome: b.outcome, client_ts: b.client_ts });
	return json({ ok: true });
}

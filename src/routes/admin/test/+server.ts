import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body, checkPid } from '$lib/server/http';
import { buildState, createTestSession, jumpTestSession } from '$lib/server/session';
import type { Phase } from '$lib/types';

/**
 * Test run-through (admin only):
 *  { action: 'create', condition, board_a_theme, board_b_theme, phase, fast } -> { pid }
 *  { action: 'jump', pid, phase, fast? } -> session state
 */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	const b = await body(request);
	if (b.action === 'create') {
		const pid = createTestSession({
			condition: String(b.condition),
			board_a_theme: String(b.board_a_theme),
			board_b_theme: String(b.board_b_theme),
			phase: b.phase as Phase,
			fast: b.fast === true
		});
		return json({ pid });
	}
	if (b.action === 'jump') {
		const s = jumpTestSession(checkPid(b.pid), b.phase as Phase, typeof b.fast === 'boolean' ? b.fast : undefined);
		return json(buildState(s));
	}
	error(400, 'unknown action');
}

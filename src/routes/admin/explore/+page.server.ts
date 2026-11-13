import { redirect } from '@sveltejs/kit';
import { isAdmin, participantDetail, summaryRows } from '$lib/server/admin';
import { experiment } from '$lib/server/experiment';
import { isTestPid } from '$lib/server/session';

export function load({ cookies, url }) {
	if (!isAdmin(cookies)) redirect(303, '/admin');
	const pid = url.searchParams.get('pid');
	const includeTests = url.searchParams.get('tests') === '1' || (!!pid && isTestPid(pid));
	const { config } = experiment();
	return {
		includeTests,
		timeLimitS: config.board_time_limit_s ?? 0,
		boardPairs: (config.board.rows * config.board.cols) / 2,
		rows: summaryRows(includeTests),
		detail: pid ? participantDetail(pid) : null,
		pid
	};
}

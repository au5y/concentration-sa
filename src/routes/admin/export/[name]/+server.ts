import { requireAdmin, tableCsv } from '$lib/server/admin';

export function GET({ params, cookies }) {
	requireAdmin(cookies);
	const name = params.name.replace(/\.csv$/, '');
	const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
	return new Response(tableCsv(name), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}_${stamp}.csv"`
		}
	});
}

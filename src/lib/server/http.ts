import { error } from '@sveltejs/kit';

export function checkPid(pid: unknown): string {
	if (typeof pid !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(pid)) error(400, 'missing or invalid pid');
	return pid;
}

export async function body(request: Request): Promise<Record<string, any>> {
	try {
		const b = await request.json();
		if (b && typeof b === 'object') return b;
	} catch {
		/* fallthrough */
	}
	error(400, 'expected a JSON body');
}

export const clientTs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

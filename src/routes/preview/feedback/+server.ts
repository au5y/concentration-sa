import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin';
import { body } from '$lib/server/http';
import { feedbackFile, saveFeedback } from '$lib/server/preview';

/** Save the review page's feedback to data/preview-feedback.json (overwrites the previous save). */
export async function POST({ request, cookies }) {
	requireAdmin(cookies);
	saveFeedback(await body(request));
	return json({ ok: true, file: feedbackFile() });
}

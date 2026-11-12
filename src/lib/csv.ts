export function csvEscape(v: unknown): string {
	if (v === null || v === undefined) return '';
	const s = typeof v === 'number' && !Number.isFinite(v) ? '' : String(v);
	return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
	const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
	const lines = [cols.join(',')];
	for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(','));
	return lines.join('\n') + '\n';
}

/** Minimal CSV parser (handles quoted fields); returns objects keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
	if (!nonEmpty.length) return [];
	const [header, ...body] = nonEmpty;
	return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

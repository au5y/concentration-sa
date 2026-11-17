/** The public front page's content (see server/landing.ts). */
export interface LandingLink {
	label: string;
	url: string;
}
export interface Landing {
	title: string;
	/** Plain text; blank lines separate paragraphs, lines starting with "• " or "- " become a list. */
	body: string;
	/** Sign-up links (e.g. one Google Calendar booking page per seat). None = sign-ups closed. */
	links: LandingLink[];
	/** Shown when there are no links. */
	closed: string;
	contact: string;
}

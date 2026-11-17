/** The public front page's content (see server/landing.ts). */
export interface LandingLink {
	label: string;
	url: string;
}
export interface LandingFact {
	label: string;
	text: string;
}
export interface Landing {
	/** Small caps line, top left and top right. */
	kicker: string;
	tag: string;
	/** Headline: first line in black, second in red. */
	title: string;
	titleAccent: string;
	/** Plain text; blank lines separate paragraphs, lines starting with "•" or "-" become a list. */
	intro: string;
	/** Label / text rows (Time, Who, Wear, Note). */
	facts: LandingFact[];
	/** When the sessions are, shown first in the sign-up box. */
	date: string;
	/** Sign-up links (e.g. a Google Calendar booking page). None = sign-ups closed. */
	links: LandingLink[];
	/** Under the button, e.g. how slots work. */
	signupNote: string;
	/** Shown when there are no links. */
	closed: string;
	contact: string;
}

export interface BetterBacklinksSettings {
	showSection: boolean;
	/** Cards start expanded when the note has this many backlinks or fewer. */
	expandUpTo: number;
	/** Mention blocks shown per card before "+N more mentions". */
	mentionsPerCard: number;
	/** Highlight links to this note, and the matching part of title-match titles. */
	highlightMatches: boolean;
	showInReadingView: boolean;
	/** Count links in a source note's properties (frontmatter) as backlinks. */
	includePropertyLinks: boolean;
	/** Show notes whose title contains this note's name, even without a link. */
	includeTitleMatches: boolean;
	/** Show notes that mention this note's name as plain text, with a way to link them. */
	showUnlinkedMentions: boolean;
	excludedFolders: string[];
}

export const DEFAULT_SETTINGS: BetterBacklinksSettings = {
	showSection: true,
	expandUpTo: 4,
	mentionsPerCard: 3,
	highlightMatches: true,
	showInReadingView: true,
	includePropertyLinks: true,
	includeTitleMatches: true,
	showUnlinkedMentions: true,
	excludedFolders: [],
};

export interface BetterBacklinksSettings {
	showSection: boolean;
	/** Cards start expanded when the note has this many backlinks or fewer. */
	expandUpTo: number;
	/** Mention blocks shown per card before "+N more mentions". */
	mentionsPerCard: number;
	showInReadingView: boolean;
	/** Count links in a source note's properties (frontmatter) as backlinks. */
	includePropertyLinks: boolean;
	excludedFolders: string[];
}

export const DEFAULT_SETTINGS: BetterBacklinksSettings = {
	showSection: true,
	expandUpTo: 4,
	mentionsPerCard: 3,
	showInReadingView: true,
	includePropertyLinks: true,
	excludedFolders: [],
};

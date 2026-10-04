import { DEFAULT_SORT, type SortOrder } from "./sort";

export interface BetterBacklinksSettings {
	showSection: boolean;
	/** Card order for notes that haven't been given their own from the sort menu. */
	defaultSort: SortOrder;
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
	/** Show backlinks, created-in-period notes and unlinked mentions as one list, one card per note. */
	combineGroups: boolean;
	excludedFolders: string[];
	/** Daily notes: show notes created on the day a daily note is for. */
	showCreatedOnDay: boolean;
	/** Daily note date format; empty uses Obsidian's Daily notes setting. */
	dailyNoteFormat: string;
	/** Daily notes folder; empty uses Obsidian's Daily notes setting. */
	dailyNoteFolder: string;
	/** Property holding a note's creation date; the file date is used without it. */
	createdProperty: string;
	/** Weekly notes: show notes created during the week a weekly note is for. */
	showCreatedThisWeek: boolean;
	/** Weekly note format; empty uses Periodic Notes' setting, else GGGG-[W]WW. */
	weeklyNoteFormat: string;
	/** Weekly notes folder; empty uses Periodic Notes' setting, else anywhere. */
	weeklyNoteFolder: string;
}

export const DEFAULT_SETTINGS: BetterBacklinksSettings = {
	showSection: true,
	defaultSort: DEFAULT_SORT,
	expandUpTo: 4,
	mentionsPerCard: 3,
	highlightMatches: true,
	showInReadingView: true,
	includePropertyLinks: true,
	includeTitleMatches: true,
	showUnlinkedMentions: true,
	combineGroups: false,
	excludedFolders: [],
	showCreatedOnDay: false,
	dailyNoteFormat: "",
	dailyNoteFolder: "",
	createdProperty: "created",
	showCreatedThisWeek: false,
	weeklyNoteFormat: "",
	weeklyNoteFolder: "",
};

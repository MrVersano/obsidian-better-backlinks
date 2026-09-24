// Unlinked backlinks by title: does another note's title contain this note's
// name as a whole word? No DOM and no runtime Obsidian imports.

export interface TitleMatch {
	/** Where the name sits in the other title, as string offsets. */
	start: number;
	end: number;
}

/**
 * Returns a matcher for titles that contain `name` as a whole word, ignoring
 * case: "2026-09-24" matches "2026-09-24 Meeting with Joe", and "Joe" matches
 * "Meeting with Joe" but not "Joel". A title equal to the name is a duplicate
 * note, not a related one, so it doesn't match. One-character names would
 * match too much and never match.
 */
export function titleMatcher(name: string): (title: string) => TitleMatch | null {
	const pattern = namePattern(name, "iu");
	if (!pattern) return () => null;
	const lower = name.trim().toLocaleLowerCase();

	return (title) => {
		if (title.trim().toLocaleLowerCase() === lower) return null;
		const match = pattern.exec(title);
		return match ? { start: match.index, end: match.index + match[0].length } : null;
	};
}

/**
 * A regex for `name` as a whole word, ignoring case. Null for names under two
 * characters, which would match too much. Shared by title matches and
 * unlinked mentions so both follow the same rule.
 */
export function namePattern(name: string, flags: "iu" | "giu"): RegExp | null {
	const trimmed = name.trim();
	if ([...trimmed].length < 2) return null;
	const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// A word boundary that understands letters and digits in any script.
	return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
}

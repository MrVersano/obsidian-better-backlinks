// Unlinked mentions: the current note's name written as plain text in another
// note. No DOM and no runtime Obsidian imports, so it can be unit-tested.

import type { CachedMetadata, Loc } from "obsidian";
import type { Mention } from "./excerpt";
import { namePattern } from "./title-match";

// Section types whose text is not prose, so a name in them isn't a mention.
const SKIPPED_SECTIONS = new Set(["code", "yaml", "html", "math"]);

// Inline spans that aren't prose either: `code`, URLs, %% comments %% and $math$.
const SKIPPED_INLINE = /`[^`\n]+`|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+|%%[\s\S]*?%%|\$[^$\n]+\$/gi;

/**
 * Every place `name` appears in `text` as a whole word (any case) outside
 * existing links, embeds, tags, frontmatter, code, URLs, comments and math.
 * Each mention's displayText is the text exactly as written.
 */
export function findUnlinkedMentions(text: string, cache: CachedMetadata, name: string): Mention[] {
	const pattern = namePattern(name, "giu");
	if (!pattern) return [];
	// Cheap rejection for the vast majority of notes.
	if (!text.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase())) return [];

	const skipped: [number, number][] = [];
	for (const item of [...(cache.links ?? []), ...(cache.embeds ?? []), ...(cache.tags ?? [])]) {
		skipped.push([item.position.start.offset, item.position.end.offset]);
	}
	for (const section of cache.sections ?? []) {
		if (SKIPPED_SECTIONS.has(section.type)) {
			skipped.push([section.position.start.offset, section.position.end.offset]);
		}
	}
	if (cache.frontmatterPosition) {
		skipped.push([cache.frontmatterPosition.start.offset, cache.frontmatterPosition.end.offset]);
	}
	for (const match of text.matchAll(SKIPPED_INLINE)) {
		skipped.push([match.index, match.index + match[0].length]);
	}

	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
	const loc = (offset: number): Loc => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo, col: offset - (lineStarts[lo] ?? 0), offset };
	};

	const mentions: Mention[] = [];
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		const end = start + match[0].length;
		if (skipped.some(([a, b]) => start < b && end > a)) continue;
		mentions.push({ position: { start: loc(start), end: loc(end) }, displayText: match[0] });
	}
	return mentions;
}

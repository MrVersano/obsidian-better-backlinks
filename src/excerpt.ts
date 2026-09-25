// Block extraction: given a source note's text, its metadata cache and the
// positions of its links to the current note, work out which blocks to show.
// No DOM and no runtime Obsidian imports, so it can be unit-tested.

import type { CachedMetadata, HeadingCache, ListItemCache, Pos } from "obsidian";

/** One link in the source note that points at the current note. */
export interface Mention {
	/** Position of the whole link (`[[...]]` or `[...](...)`) in the source file. */
	position: Pos;
	/** The link's visible text as written: the alias if there is one. */
	displayText: string;
}

export interface Excerpt {
	/** Markdown to render: ancestor context lines followed by the block itself. */
	markdown: string;
	/** Source line for each excerpt line (`lineMap[i]` is the source line of excerpt line `i`). */
	lineMap: number[];
	/** How many list items at the top of the excerpt are ancestor context, outermost first. */
	ancestorCount: number;
	/** The mentions inside this excerpt, in document order. */
	mentions: Mention[];
	/**
	 * Every reference to the current note that renders as an `a.internal-link`, in document
	 * order: each mention, plus `null` for an embed of the current note (rendered as a link).
	 * Lets the view pair rendered anchors with mentions.
	 */
	anchors: (Mention | null)[];
	/** Source lines of the task list items in the excerpt, in document order. */
	taskLines: number[];
	/** First and last source line of the block (excluding ancestor context). */
	startLine: number;
	endLine: number;
}

interface Block {
	start: number;
	end: number;
	/** Ancestor list items, outermost first; only set for nested list items. */
	ancestors: ListItemCache[];
	mentions: Mention[];
}

/** Class of the span that marks an unlinked mention in excerpt markdown. */
export const UNLINKED_CLASS = "better-backlinks-unlinked";

/**
 * Builds one excerpt per distinct block. Mentions that share a block, or whose
 * blocks contain one another, are merged into a single excerpt.
 * `targetEmbeds` are positions of `![[...]]` embeds of the current note.
 * With `markMentions`, each mention's text is wrapped in a span carrying its
 * index in the excerpt's `mentions`, so plain-text (unlinked) mentions can be
 * found after rendering.
 */
export function extractExcerpts(
	text: string,
	cache: CachedMetadata,
	mentions: Mention[],
	targetEmbeds: Pos[] = [],
	{ markMentions = false } = {},
): Excerpt[] {
	const lines = text.split(/\r?\n/);
	const doc = new DocStructure(lines, cache);

	const blocks: Block[] = [];
	for (const mention of mentions) {
		const line = mention.position.start.line;
		if (doc.isInCode(line)) continue;
		const block = doc.blockAt(line);
		if (block) blocks.push({ ...block, mentions: [mention] });
	}

	return mergeBlocks(blocks).map((block) => doc.toExcerpt(block, targetEmbeds, markMentions));
}

/** Merges blocks that overlap, keeping the outer block's ancestor context. */
function mergeBlocks(blocks: Block[]): Block[] {
	const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: Block[] = [];
	for (const block of sorted) {
		const last = merged[merged.length - 1];
		if (last && block.start <= last.end) {
			last.end = Math.max(last.end, block.end);
			last.mentions.push(...block.mentions);
		} else {
			merged.push({ ...block, mentions: [...block.mentions] });
		}
	}
	for (const block of merged) {
		block.mentions.sort((a, b) => a.position.start.offset - b.position.start.offset);
	}
	return merged;
}

class DocStructure {
	private readonly headings: HeadingCache[];
	private readonly items: ListItemCache[];
	private readonly itemByLine = new Map<number, ListItemCache>();
	private readonly children = new Map<ListItemCache, ListItemCache[]>();
	private readonly parentOf = new Map<ListItemCache, ListItemCache>();

	constructor(
		private readonly lines: string[],
		private readonly cache: CachedMetadata,
	) {
		this.headings = [...(cache.headings ?? [])].sort(byStartLine);
		this.items = [...(cache.listItems ?? [])].sort(byStartLine);

		for (const item of this.items) this.itemByLine.set(item.position.start.line, item);
		for (const item of this.items) {
			const parent = this.parentItem(item);
			if (!parent) continue;
			this.parentOf.set(item, parent);
			const siblings = this.children.get(parent) ?? [];
			siblings.push(item);
			this.children.set(parent, siblings);
		}
	}

	isInCode(line: number): boolean {
		return this.sectionAt(line)?.type === "code";
	}

	/** The innermost block containing `line`, per the spec's table. */
	blockAt(line: number): Omit<Block, "mentions"> | null {
		const heading = this.headings.find((h) => h.position.start.line === line);
		if (heading) return { start: line, end: this.headingSectionEnd(heading), ancestors: [] };

		const item = this.listItemAt(line);
		if (item) {
			return {
				start: item.position.start.line,
				end: this.subtreeEnd(item),
				ancestors: this.ancestorsOf(item),
			};
		}

		const section = this.sectionAt(line);
		if (section) {
			return {
				start: section.position.start.line,
				end: this.trimBlankEnd(section.position.start.line, section.position.end.line),
				ancestors: [],
			};
		}
		return { start: line, end: line, ancestors: [] };
	}

	toExcerpt(block: Block, targetEmbeds: Pos[], markMentions: boolean): Excerpt {
		const lineMap: number[] = [];
		for (const ancestor of block.ancestors) {
			const [start, end] = this.ownLines(ancestor);
			for (let l = start; l <= end; l++) lineMap.push(l);
		}
		for (let l = block.start; l <= block.end; l++) lineMap.push(l);

		const markdown = lineMap
			.map((l) => {
				let line = this.lines[l] ?? "";
				if (this.isInCode(l)) return line;
				if (markMentions) line = markLine(line, l, block.mentions);
				return embedsAsLinks(line);
			})
			.join("\n");

		const inBlock = (line: number) => lineMap.includes(line);
		const embeds = targetEmbeds.filter((p) => inBlock(p.start.line));
		const anchors = [...block.mentions.map((m) => ({ pos: m.position, m })), ...embeds.map((pos) => ({ pos, m: null }))]
			.sort((a, b) => a.pos.start.offset - b.pos.start.offset)
			.map((a) => a.m);

		const taskLines = this.items
			.filter((item) => item.task !== undefined && inBlock(item.position.start.line))
			.map((item) => item.position.start.line);

		return {
			markdown,
			lineMap,
			ancestorCount: block.ancestors.length,
			mentions: block.mentions,
			anchors,
			taskLines,
			startLine: block.start,
			endLine: block.end,
		};
	}

	private sectionAt(line: number) {
		return this.cache.sections?.find(
			(s) => s.position.start.line <= line && line <= s.position.end.line,
		);
	}

	/** The heading plus everything until the next heading of the same or higher level. */
	private headingSectionEnd(heading: HeadingCache): number {
		const next = this.headings.find(
			(h) => h.position.start.line > heading.position.start.line && h.level <= heading.level,
		);
		const end = next ? next.position.start.line - 1 : this.lastContentLine();
		return this.trimBlankEnd(heading.position.start.line, end);
	}

	/** The innermost list item whose own lines (not its children's) contain `line`. */
	private listItemAt(line: number): ListItemCache | undefined {
		return this.items.find((item) => {
			const [start, end] = this.ownLines(item);
			return start <= line && line <= end;
		});
	}

	/**
	 * The lines that belong to the item itself: from its first line up to, but not
	 * including, the next list item. Works whether or not the cache's position for
	 * an item spans its children.
	 */
	private ownLines(item: ListItemCache): [number, number] {
		const start = item.position.start.line;
		const next = this.items.find((i) => i.position.start.line > start);
		let end = item.position.end.line;
		if (next && next.position.start.line <= end) end = next.position.start.line - 1;
		return [start, this.trimBlankEnd(start, end)];
	}

	private subtreeEnd(item: ListItemCache): number {
		let end = this.ownLines(item)[1];
		for (const child of this.children.get(item) ?? []) end = Math.max(end, this.subtreeEnd(child));
		return end;
	}

	private ancestorsOf(item: ListItemCache): ListItemCache[] {
		const ancestors: ListItemCache[] = [];
		for (let p = this.parentOf.get(item); p; p = this.parentOf.get(p)) ancestors.unshift(p);
		return ancestors;
	}

	/**
	 * `parent` is the parent item's line, or the negated line of the list's first item
	 * for top-level items. For a list starting on line 0 that is -0, which looks like a
	 * real parent on line 0, so also require the child to be indented further.
	 */
	private parentItem(item: ListItemCache): ListItemCache | undefined {
		if (item.parent < 0 || Object.is(item.parent, -0)) return undefined;
		const parent = this.itemByLine.get(item.parent);
		if (!parent || parent === item) return undefined;
		if (this.indentOf(item) <= this.indentOf(parent)) return undefined;
		return parent;
	}

	/** Width of the whitespace (and blockquote markers) before a list item's marker. */
	private indentOf(item: ListItemCache): number {
		const prefix = /^[\s>]*/.exec(this.lines[item.position.start.line] ?? "")?.[0] ?? "";
		return prefix.replace(/\t/g, "    ").length;
	}

	private lastContentLine(): number {
		return this.lines.length - 1;
	}

	private trimBlankEnd(start: number, end: number): number {
		while (end > start && (this.lines[end] ?? "").trim() === "") end--;
		return end;
	}
}

function byStartLine(a: { position: Pos }, b: { position: Pos }): number {
	return a.position.start.line - b.position.start.line;
}

/** Wraps the mentions on source line `line` in marker spans, right to left so columns stay valid. */
function markLine(text: string, line: number, mentions: Mention[]): string {
	const onLine = mentions
		.map((m, index) => ({ m, index }))
		.filter(({ m }) => m.position.start.line === line && m.position.end.line === line)
		.sort((a, b) => b.m.position.start.col - a.m.position.start.col);
	for (const { m, index } of onLine) {
		const { col: start } = m.position.start;
		const { col: end } = m.position.end;
		const open = `<span class="${UNLINKED_CLASS}" data-mention="${index}">`;
		text = text.slice(0, start) + open + text.slice(start, end) + "</span>" + text.slice(end);
	}
	return text;
}

/** Excerpts show embeds as plain links rather than transcluding them. */
function embedsAsLinks(line: string): string {
	return line.replace(/!\[\[/g, "[[");
}

/**
 * The start of a note, for previewing it: its first few blocks after the
 * properties, capped at `maxLines` lines. Null when the note has no body.
 */
export function noteStartExcerpt(
	text: string,
	cache: CachedMetadata,
	{ maxBlocks = 3, maxLines = 15 } = {},
): Excerpt | null {
	const lines = text.split(/\r?\n/);
	const blocks = (cache.sections ?? []).filter((s) => s.type !== "yaml").slice(0, maxBlocks);
	const first = blocks[0];
	const last = blocks[blocks.length - 1];
	if (!first || !last) return null;

	const start = first.position.start.line;
	const end = Math.min(last.position.end.line, start + maxLines - 1);
	const inCode = (line: number) =>
		(cache.sections ?? []).some(
			(s) => s.type === "code" && s.position.start.line <= line && line <= s.position.end.line,
		);
	const lineMap: number[] = [];
	for (let l = start; l <= end; l++) lineMap.push(l);

	return {
		markdown: lineMap.map((l) => (inCode(l) ? (lines[l] ?? "") : embedsAsLinks(lines[l] ?? ""))).join("\n"),
		lineMap,
		ancestorCount: 0,
		mentions: [],
		anchors: [],
		taskLines: (cache.listItems ?? [])
			.filter((item) => item.task !== undefined && item.position.start.line >= start && item.position.start.line <= end)
			.map((item) => item.position.start.line)
			.sort((a, b) => a - b),
		startLine: start,
		endLine: end,
	};
}

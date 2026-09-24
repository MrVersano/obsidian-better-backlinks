// Finds which notes link to the current note, and loads their excerpts.
// Uses only the public metadataCache API; no DOM.

import { getLinkpath, type App, type FrontmatterLinkCache, type Pos, type TFile } from "obsidian";
import { extractExcerpts, type Excerpt, type Mention } from "./excerpt";
import { titleMatcher, type TitleMatch } from "./title-match";
import { findUnlinkedMentions } from "./unlinked";

/**
 * A note that refers to the current note. Linked sources are known from the
 * metadata cache alone; unlinked ones (the name written as plain text) need
 * the note's text.
 */
export interface BacklinkSource {
	kind: "linked" | "unlinked";
	file: TFile;
	/** Links to the current note, or for unlinked sources, the plain-text mentions. */
	mentions: Mention[];
	/** Embeds of the current note in this source; not mentions, but shown as links. */
	targetEmbeds: Pos[];
	/** Links to the current note in the source's properties (empty when that setting is off). */
	propertyMentions: FrontmatterLinkCache[];
	/** Set when the source has no links here but its title contains the current note's name. */
	titleMatch: TitleMatch | null;
}

export interface FindOptions {
	excludedFolders: string[];
	includePropertyLinks: boolean;
	includeTitleMatches: boolean;
}

/** Links in the body plus links in properties, as shown in a card's meta. */
export function mentionCount(source: BacklinkSource): number {
	return source.mentions.length + source.propertyMentions.length;
}

/**
 * All notes with at least one resolved link to `target`, plus (when enabled)
 * notes whose title contains its name, in no particular order (the view sorts
 * them). Synchronous and cheap: it reads only the metadata cache and file
 * names, so the header can render before any file is read.
 */
export function findBacklinkSources(app: App, target: TFile, options: FindOptions): BacklinkSource[] {
	if (target.extension !== "md") return [];

	const sources: BacklinkSource[] = [];
	for (const [sourcePath, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (!(target.path in dests) || sourcePath === target.path) continue;
		if (isExcluded(sourcePath, options.excludedFolders)) continue;

		const file = app.vault.getFileByPath(sourcePath);
		if (!file || file.extension !== "md") continue;

		const source = collectLinks(app, file, target, options.includePropertyLinks);
		if (mentionCount(source) > 0) sources.push(source);
	}

	if (options.includeTitleMatches) {
		// A note that links here already has a card; a title match only adds the rest.
		const linked = new Set(sources.map((s) => s.file.path));
		const match = titleMatcher(target.basename);
		for (const file of app.vault.getMarkdownFiles()) {
			if (file === target || linked.has(file.path) || isExcluded(file.path, options.excludedFolders)) continue;
			const titleMatch = match(file.basename);
			if (titleMatch) {
				sources.push({ kind: "linked", file, mentions: [], targetEmbeds: [], propertyMentions: [], titleMatch });
			}
		}
	}

	return sources;
}

const SCAN_BATCH = 100;

/**
 * Finds unlinked mentions of `target` across the vault. Reading every note
 * takes a while in a large vault, so it runs in batches, handing each batch's
 * finds to `onFound` and yielding between batches. Stops when `cancelled()`.
 */
export async function scanUnlinked(
	app: App,
	target: TFile,
	excludedFolders: string[],
	onFound: (sources: BacklinkSource[]) => void,
	cancelled: () => boolean,
): Promise<void> {
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => file !== target && !isExcluded(file.path, excludedFolders));
	for (let i = 0; i < files.length; i += SCAN_BATCH) {
		if (cancelled()) return;
		const batch = files.slice(i, i + SCAN_BATCH);
		const found = await Promise.all(batch.map((file) => findUnlinked(app, file, target)));
		if (cancelled()) return;
		onFound(found.filter((source): source is BacklinkSource => source !== null));
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	}
}

/** The unlinked mentions of `target` in one note, or null if there are none. */
export async function findUnlinked(app: App, file: TFile, target: TFile): Promise<BacklinkSource | null> {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache || file === target) return null;
	const text = await app.vault.cachedRead(file);
	const mentions = findUnlinkedMentions(text, cache, target.basename);
	if (mentions.length === 0) return null;
	return { kind: "unlinked", file, mentions, targetEmbeds: [], propertyMentions: [], titleMatch: null };
}

/** Reads the source note and builds its excerpts. */
export async function loadExcerpts(app: App, source: BacklinkSource, target: TFile): Promise<Excerpt[]> {
	const cache = app.metadataCache.getFileCache(source.file);
	if (!cache) return [];
	const text = await app.vault.cachedRead(source.file);
	if (source.kind === "unlinked") {
		// Find the mentions again in the text being rendered, in case it changed since the scan.
		const mentions = findUnlinkedMentions(text, cache, target.basename);
		return extractExcerpts(text, cache, mentions, [], { markMentions: true });
	}
	return extractExcerpts(text, cache, source.mentions, source.targetEmbeds);
}

/** True when `linktext` (as written in `sourcePath`) resolves to `target`. */
export function resolvesTo(app: App, linktext: string, sourcePath: string, target: TFile): boolean {
	const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
	return dest?.path === target.path;
}

function collectLinks(app: App, file: TFile, target: TFile, includePropertyLinks: boolean): BacklinkSource {
	const cache = app.metadataCache.getFileCache(file);
	const codeSections = (cache?.sections ?? []).filter((s) => s.type === "code");
	const inCode = (line: number) =>
		codeSections.some((s) => s.position.start.line <= line && line <= s.position.end.line);

	// Frontmatter links live in cache.frontmatterLinks and embeds in cache.embeds,
	// so cache.links already leaves both out.
	const mentions: Mention[] = (cache?.links ?? [])
		.filter((link) => !inCode(link.position.start.line) && resolvesTo(app, link.link, file.path, target))
		.map((link) => ({ position: link.position, displayText: link.displayText ?? link.link }));

	const targetEmbeds = (cache?.embeds ?? [])
		.filter((embed) => resolvesTo(app, embed.link, file.path, target))
		.map((embed) => embed.position);

	const propertyMentions = includePropertyLinks
		? (cache?.frontmatterLinks ?? []).filter((link) => resolvesTo(app, link.link, file.path, target))
		: [];

	return { kind: "linked", file, mentions, targetEmbeds, propertyMentions, titleMatch: null };
}

export function isExcluded(path: string, folders: string[]): boolean {
	return folders.some((folder) => {
		const prefix = folder.replace(/^\/+|\/+$/g, "");
		return prefix !== "" && path.startsWith(prefix + "/");
	});
}

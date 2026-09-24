// Finds which notes link to the current note, and loads their excerpts.
// Uses only the public metadataCache API; no DOM.

import { getLinkpath, type App, type Pos, type TFile } from "obsidian";
import { extractExcerpts, type Excerpt, type Mention } from "./excerpt";

/** A note that links to the current note, known from the metadata cache alone. */
export interface BacklinkSource {
	file: TFile;
	mentions: Mention[];
	/** Embeds of the current note in this source; not mentions, but shown as links. */
	targetEmbeds: Pos[];
}

/**
 * All notes with at least one resolved link to `target`, most recently modified
 * first, then by title so cards keep a stable order. Synchronous and cheap: it
 * reads only the metadata cache, so the header can render before any file is read.
 */
export function findBacklinkSources(app: App, target: TFile, excludedFolders: string[]): BacklinkSource[] {
	if (target.extension !== "md") return [];

	const sources: BacklinkSource[] = [];
	for (const [sourcePath, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (!(target.path in dests) || sourcePath === target.path) continue;
		if (isExcluded(sourcePath, excludedFolders)) continue;

		const file = app.vault.getFileByPath(sourcePath);
		if (!file || file.extension !== "md") continue;

		const source = collectLinks(app, file, target);
		if (source.mentions.length > 0) sources.push(source);
	}

	return sources.sort(
		(a, b) =>
			b.file.stat.mtime - a.file.stat.mtime ||
			a.file.basename.localeCompare(b.file.basename) ||
			a.file.path.localeCompare(b.file.path),
	);
}

/** Reads the source note and builds its excerpts. */
export async function loadExcerpts(app: App, source: BacklinkSource): Promise<Excerpt[]> {
	const cache = app.metadataCache.getFileCache(source.file);
	if (!cache) return [];
	const text = await app.vault.cachedRead(source.file);
	return extractExcerpts(text, cache, source.mentions, source.targetEmbeds);
}

/** True when `linktext` (as written in `sourcePath`) resolves to `target`. */
export function resolvesTo(app: App, linktext: string, sourcePath: string, target: TFile): boolean {
	const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
	return dest?.path === target.path;
}

function collectLinks(app: App, file: TFile, target: TFile): BacklinkSource {
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

	return { file, mentions, targetEmbeds };
}

function isExcluded(path: string, folders: string[]): boolean {
	return folders.some((folder) => {
		const prefix = folder.replace(/^\/+|\/+$/g, "");
		return prefix !== "" && path.startsWith(prefix + "/");
	});
}

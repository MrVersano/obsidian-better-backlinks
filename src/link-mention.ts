// Turning unlinked mentions into links in the source note.

import type { App, TFile } from "obsidian";
import type { Mention } from "./excerpt";

/**
 * Replaces each mention's text in `source` with a link to `target`, built by
 * Obsidian so it follows the vault's link settings (wikilinks or Markdown
 * links, path format). The text as written is kept as the link's display text
 * when it differs from the link. A mention whose text no longer matches (the
 * note changed since it was found) is left alone. Returns how many were linked.
 */
/**
 * A link to `target` that reads as `written`. Obsidian's generator drops an
 * alias that differs from the link only in case, which would turn
 * "project atlas" into [[project atlas]]; keep it as [[Project Atlas|project atlas]].
 */
function makeLink(app: App, source: TFile, target: TFile, linktext: string, written: string): string {
	if (written === linktext) return app.fileManager.generateMarkdownLink(target, source.path);
	const plain = app.fileManager.generateMarkdownLink(target, source.path);
	// Wikilink format: add the alias ourselves. Markdown links always carry their own text.
	if (plain.startsWith("[[") && plain.endsWith("]]")) return `${plain.slice(0, -2)}|${written}]]`;
	return app.fileManager.generateMarkdownLink(target, source.path, undefined, written);
}

export async function linkMentions(app: App, source: TFile, target: TFile, mentions: Mention[]): Promise<number> {
	const linktext = app.metadataCache.fileToLinktext(target, source.path, true);
	let linked = 0;
	await app.vault.process(source, (text) => {
		// Right to left, so earlier offsets stay valid as the text grows.
		const ordered = [...mentions].sort((a, b) => b.position.start.offset - a.position.start.offset);
		for (const mention of ordered) {
			const start = mention.position.start.offset;
			const end = mention.position.end.offset;
			const written = text.slice(start, end);
			if (written !== mention.displayText) continue;
			text = text.slice(0, start) + makeLink(app, source, target, linktext, written) + text.slice(end);
			linked++;
		}
		return text;
	});
	return linked;
}

// The combined list: backlinks, notes created in a periodic note's day or
// week, and unlinked mentions merged into one source per note. No DOM and no
// runtime Obsidian imports, so it can be unit-tested.

import type { BacklinkSource } from "./backlink-index";

export /**
 * Merges the three lists into one source per note, for the combined view. A
 * note that links here keeps its links and gains any plain-text mentions and
 * creation time; one that's only created in the period and mentioned becomes
 * an unlinked card that remembers when it was created.
 */
function combineSources(
	linked: BacklinkSource[],
	created: BacklinkSource[],
	unlinked: BacklinkSource[],
): BacklinkSource[] {
	const byPath = new Map<string, BacklinkSource>();
	for (const source of linked) byPath.set(source.file.path, { ...source });
	for (const source of created) {
		const existing = byPath.get(source.file.path);
		if (existing) existing.created = source.created;
		else byPath.set(source.file.path, { ...source });
	}
	for (const source of unlinked) {
		const existing = byPath.get(source.file.path);
		if (!existing) byPath.set(source.file.path, { ...source });
		else if (existing.kind === "created") byPath.set(source.file.path, { ...source, created: existing.created });
		else existing.unlinked = source.mentions;
	}
	return [...byPath.values()];
}

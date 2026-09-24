// Property rows: which of a source note's properties link to the current note,
// and the values to show beside each one. No DOM and no runtime Obsidian
// imports, so it can be unit-tested.

import type { FrontMatterCache, FrontmatterLinkCache } from "obsidian";

export interface PropertyValue {
	text: string;
	/** Set when the value is a link; `isMention` when it points at the current note. */
	link?: { linktext: string; isMention: boolean };
}

export interface PropertyRow {
	key: string;
	values: PropertyValue[];
}

/**
 * One row per top-level property that links to the current note, in the order
 * the properties appear, showing all of that property's values. Obsidian keys
 * a list item's link as `related.0`, `related.1`, and a single value's as `related`.
 */
export function propertyRows(
	frontmatter: FrontMatterCache | undefined,
	links: FrontmatterLinkCache[],
	isTarget: (linktext: string) => boolean,
): PropertyRow[] {
	const topKey = (key: string) => key.split(".")[0] ?? key;
	const linkedKeys = new Set(links.filter((l) => isTarget(l.link)).map((l) => topKey(l.key)));
	const linkAt = new Map(links.map((l) => [l.key, l]));
	const placed = new Set<FrontmatterLinkCache>();

	const keys = [...Object.keys(frontmatter ?? {}), ...linkedKeys].filter(
		(key, i, all) => linkedKeys.has(key) && all.indexOf(key) === i,
	);

	return keys.map((key) => {
		const raw: unknown = frontmatter?.[key];
		const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
		const values: PropertyValue[] = [];

		list.forEach((value, i) => {
			const link = linkAt.get(Array.isArray(raw) ? `${key}.${i}` : key);
			if (link) {
				placed.add(link);
				values.push(toValue(link, isTarget));
			} else if (value !== null && typeof value !== "object") {
				values.push({ text: String(value) });
			}
		});

		// Links nested deeper (objects in properties) have no simple place; list them at the end.
		for (const link of links) {
			if (!placed.has(link) && topKey(link.key) === key) values.push(toValue(link, isTarget));
		}
		return { key, values };
	});
}

function toValue(link: FrontmatterLinkCache, isTarget: (linktext: string) => boolean): PropertyValue {
	return {
		text: link.displayText ?? link.link,
		link: { linktext: link.link, isMention: isTarget(link.link) },
	};
}

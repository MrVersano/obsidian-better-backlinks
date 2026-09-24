// Card order: by name, modified date or created date, either direction.
// No DOM and no runtime Obsidian imports, so it can be unit-tested.

export type SortOrder = "modified-desc" | "modified-asc" | "created-desc" | "created-asc" | "name-asc" | "name-desc";

export const DEFAULT_SORT: SortOrder = "modified-desc";

/** In menu order, with the labels shown in the sort menu and settings. */
export const SORT_ORDERS: { order: SortOrder; label: string }[] = [
	{ order: "modified-desc", label: "Modified (newest first)" },
	{ order: "modified-asc", label: "Modified (oldest first)" },
	{ order: "created-desc", label: "Created (newest first)" },
	{ order: "created-asc", label: "Created (oldest first)" },
	{ order: "name-asc", label: "Name (A to Z)" },
	{ order: "name-desc", label: "Name (Z to A)" },
];

export function isSortOrder(value: unknown): value is SortOrder {
	return SORT_ORDERS.some((o) => o.order === value);
}

export function sortLabel(order: SortOrder): string {
	return SORT_ORDERS.find((o) => o.order === order)?.label ?? order;
}

interface Sortable {
	file: { basename: string; path: string; stat: { mtime: number; ctime: number } };
}

// "Note 2" before "Note 10", and case doesn't split otherwise equal names.
const byName = (a: Sortable, b: Sortable) =>
	a.file.basename.localeCompare(b.file.basename, undefined, { numeric: true, sensitivity: "base" }) ||
	a.file.path.localeCompare(b.file.path);

/** A comparator for `order`. Ties fall back to name, so cards never shuffle between renders. */
export function compareBy(order: SortOrder): (a: Sortable, b: Sortable) => number {
	switch (order) {
		case "name-asc":
			return byName;
		case "name-desc":
			return (a, b) => byName(b, a);
		case "modified-desc":
			return (a, b) => b.file.stat.mtime - a.file.stat.mtime || byName(a, b);
		case "modified-asc":
			return (a, b) => a.file.stat.mtime - b.file.stat.mtime || byName(a, b);
		case "created-desc":
			return (a, b) => b.file.stat.ctime - a.file.stat.ctime || byName(a, b);
		case "created-asc":
			return (a, b) => a.file.stat.ctime - b.file.stat.ctime || byName(a, b);
	}
}

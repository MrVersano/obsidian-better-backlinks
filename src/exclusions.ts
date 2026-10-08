// Folders and notes kept out of every backlinks group. No DOM and no runtime
// Obsidian imports, so it can be unit-tested.

export interface Exclusions {
	/** Folder paths; every note inside one, at any depth, is excluded. */
	folders: string[];
	/** Note paths, including the .md extension. */
	notes: string[];
}

export function isExcluded(path: string, { folders, notes }: Exclusions): boolean {
	if (notes.includes(path)) return true;
	return folders.some((folder) => {
		const prefix = folder.replace(/^\/+|\/+$/g, "");
		return prefix !== "" && path.startsWith(prefix + "/");
	});
}

/**
 * Follows a rename of a note or folder: entries equal to `oldPath`, or inside
 * it when it's a folder, move to `newPath`. Returns null when nothing changed.
 */
export function renameInList(paths: string[], oldPath: string, newPath: string): string[] | null {
	let changed = false;
	const renamed = paths.map((path) => {
		if (path === oldPath) {
			changed = true;
			return newPath;
		}
		if (path.startsWith(oldPath + "/")) {
			changed = true;
			return newPath + path.slice(oldPath.length);
		}
		return path;
	});
	return changed ? renamed : null;
}

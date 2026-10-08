/** The core Backlinks plugin's id, which is also its settings tab's id. */
export const CORE_BACKLINKS = "backlink";

/**
 * True when the core Backlinks plugin is on with "Show backlinks at the bottom
 * of notes". `enabledCorePlugins` is core-plugins.json, a list of ids in newer
 * versions of Obsidian and a map of id to on/off in older ones; `options` is
 * backlink.json.
 */
export function coreBacklinksInDocument(enabledCorePlugins: unknown, options: unknown): boolean {
	const enabled = Array.isArray(enabledCorePlugins)
		? enabledCorePlugins.includes(CORE_BACKLINKS)
		: typeof enabledCorePlugins === "object" &&
			enabledCorePlugins !== null &&
			(enabledCorePlugins as Record<string, unknown>)[CORE_BACKLINKS] === true;
	if (!enabled || typeof options !== "object" || options === null) return false;
	return (options as { backlinkInDocument?: unknown }).backlinkInDocument === true;
}

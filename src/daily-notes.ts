// Daily notes: which day a daily note is for, and when another note was
// created. No DOM and no runtime Obsidian imports; the date library is passed
// in (Obsidian's bundled moment in the plugin, the npm package in tests).

import type { Moment } from "moment";

/** The part of moment() this module uses: strict parsing against a format. */
export type MomentFn = (input: string, format: string | string[], strict: boolean) => Moment;

export interface DailyNoteConfig {
	/** moment format of a daily note's path relative to `folder`, e.g. "YYYY-MM-DD". */
	format: string;
	/** Folder daily notes live in; empty for anywhere. */
	folder: string;
}

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

/** A day in local time, as [start, end) timestamps. */
export interface Day {
	start: number;
	end: number;
}

/**
 * The day `path` is the daily note for, or null if it isn't one. A format
 * with slashes (e.g. "YYYY/MM/YYYY-MM-DD") must match the path under the
 * folder; a plain format matches the note's name wherever it sits inside it.
 */
export function dailyNoteDay(path: string, config: DailyNoteConfig, moment: MomentFn): Day | null {
	if (!path.endsWith(".md")) return null;
	const folder = config.folder.replace(/^\/+|\/+$/g, "");
	let relative = path.slice(0, -".md".length);
	if (folder) {
		if (!relative.startsWith(folder + "/")) return null;
		relative = relative.slice(folder.length + 1);
	}
	const format = config.format.trim() || DEFAULT_DAILY_FORMAT;
	const name = format.includes("/") ? relative : (relative.split("/").pop() ?? relative);
	const date = moment(name, format, true);
	if (!date.isValid()) return null;
	const start = date.clone().startOf("day");
	return { start: start.valueOf(), end: start.clone().add(1, "day").valueOf() };
}

export interface CreatedAt {
	time: number;
	/** False when the date came from a property with no time of day. */
	hasTime: boolean;
}

const PROPERTY_FORMATS = ["YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm", "YYYY-MM-DD"];

/**
 * When a note was created: from its `property` (e.g. created: 2026-09-24 or
 * 2026-09-24T09:42) when that holds a date, otherwise the file's creation
 * time. A property survives sync, copies and restores that reset file dates.
 */
export function createdAt(
	frontmatter: Record<string, unknown> | undefined,
	property: string,
	ctime: number,
	moment: MomentFn,
): CreatedAt {
	const raw = property ? frontmatter?.[property] : undefined;
	if (typeof raw === "string") {
		const value = raw.trim();
		const date = moment(value, PROPERTY_FORMATS, true);
		if (date.isValid()) return { time: date.valueOf(), hasTime: value.length > "YYYY-MM-DD".length };
	}
	return { time: ctime, hasTime: true };
}

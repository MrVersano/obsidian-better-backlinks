// Periodic notes: which day a daily note or which week a weekly note is for,
// and when another note was created. No DOM and no runtime Obsidian imports;
// the date library is passed in (Obsidian's bundled moment in the plugin, the
// npm package in tests).

import type { Moment } from "moment";

/** The part of moment() this module uses: strict parsing against a format. */
export type MomentFn = (input: string, format: string | string[], strict: boolean) => Moment;

export interface PeriodicNoteConfig {
	/** moment format of a note's path relative to `folder`, e.g. "YYYY-MM-DD" or "GGGG-[W]WW". */
	format: string;
	/** Folder the notes live in; empty for anywhere. */
	folder: string;
}

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";
/** ISO week, e.g. 2026-W40. */
export const DEFAULT_WEEKLY_FORMAT = "GGGG-[W]WW";
/** What the Periodic Notes plugin uses when its weekly format is left empty. */
export const PERIODIC_NOTES_WEEKLY_FORMAT = "gggg-[W]ww";

/**
 * The weekly-note settings in Periodic Notes' data.json, or null when weekly
 * notes are off. Handles version 1 ({ weekly }) and the version 2 beta
 * ({ calendarSets: [{ id, week }], activeCalendarSet }).
 */
export function periodicNotesWeekly(data: unknown): PeriodicNoteConfig | null {
	if (!data || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	let weekly: unknown = record.weekly;
	if (!weekly && Array.isArray(record.calendarSets)) {
		const sets = record.calendarSets as Record<string, unknown>[];
		const active = sets.find((set) => set.id === record.activeCalendarSet) ?? sets[0];
		weekly = active?.week;
	}
	if (!weekly || typeof weekly !== "object") return null;
	const { enabled, format, folder } = weekly as Record<string, unknown>;
	if (enabled === false) return null;
	return {
		format: typeof format === "string" && format.trim() ? format.trim() : PERIODIC_NOTES_WEEKLY_FORMAT,
		folder: typeof folder === "string" ? folder.trim() : "",
	};
}

/** A stretch of local time, as [start, end) timestamps. */
export interface Period {
	start: number;
	end: number;
}

/**
 * The period `path` is the periodic note for, or null if it isn't one. A
 * format with slashes (e.g. "YYYY/MM/YYYY-MM-DD") must match the path under
 * the folder; a plain format matches the note's name wherever it sits inside it.
 *
 * Weeks follow the format: ISO tokens (W, G) mean ISO weeks, Monday to Sunday;
 * locale tokens (w, g) mean the locale's weeks.
 */
export function periodicNoteRange(
	path: string,
	config: PeriodicNoteConfig,
	unit: "day" | "week",
	moment: MomentFn,
): Period | null {
	if (!path.endsWith(".md")) return null;
	const folder = config.folder.replace(/^\/+|\/+$/g, "");
	let relative = path.slice(0, -".md".length);
	if (folder) {
		if (!relative.startsWith(folder + "/")) return null;
		relative = relative.slice(folder.length + 1);
	}
	const format = config.format.trim() || (unit === "day" ? DEFAULT_DAILY_FORMAT : DEFAULT_WEEKLY_FORMAT);
	const name = format.includes("/") ? relative : (relative.split("/").pop() ?? relative);
	const date = moment(name, format, true);
	if (!date.isValid()) return null;
	const start = date.clone().startOf(unit === "day" ? "day" : usesIsoWeeks(format) ? "isoWeek" : "week");
	return { start: start.valueOf(), end: start.clone().add(1, unit).valueOf() };
}

/** The day `path` is the daily note for, or null if it isn't one. */
export function dailyNoteDay(path: string, config: PeriodicNoteConfig, moment: MomentFn): Period | null {
	return periodicNoteRange(path, config, "day", moment);
}

/** Whether a format uses ISO week tokens (W, G) outside its [literal] parts. */
function usesIsoWeeks(format: string): boolean {
	return /[WG]/.test(format.replace(/\[[^\]]*\]/g, ""));
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

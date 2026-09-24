// Small pure formatting helpers for the section's text.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `now`, `5m`, `2h`, `4d`, `1w`, `3w`, then `Mar 4` (with the year if it isn't this year). */
export function formatAge(mtime: number, now = Date.now()): string {
	const diff = Math.max(0, now - mtime);
	if (diff < MINUTE) return "just now";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
	if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
	if (diff < 4 * WEEK) return `${Math.floor(diff / WEEK)}w ago`;
	const date = new Date(mtime);
	const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
	return date.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;

/**
 * Flips the task checkbox on one line of `text`. Returns null when that line
 * is no longer a task (the file changed since the excerpt was rendered).
 */
export function toggleTask(text: string, line: number): string | null {
	const lines = text.split("\n");
	const current = lines[line];
	const match = current === undefined ? null : TASK_RE.exec(current);
	if (!match || current === undefined) return null;
	const next = match[2] === " " ? "x" : " ";
	lines[line] = match[1] + next + match[3] + current.slice(match[0].length);
	return lines.join("\n");
}

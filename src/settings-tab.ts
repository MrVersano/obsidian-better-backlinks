import {
	AbstractInputSuggest,
	normalizePath,
	prepareFuzzySearch,
	PluginSettingTab,
	renderResults,
	setIcon,
	Setting,
	TFile,
	TFolder,
	type App,
	type SearchResult,
	type SettingDefinition,
	type SettingDefinitionItem,
} from "obsidian";
import type BetterBacklinksPlugin from "./main";
import type { BetterBacklinksSettings } from "./settings";
import { isExcluded, type Exclusions } from "./exclusions";
import { DEFAULT_WEEKLY_FORMAT } from "./periodic-notes";
import { isSortOrder, SORT_ORDERS } from "./sort";

type Key = keyof BetterBacklinksSettings;

/**
 * Settings are declared once. Obsidian 1.13+ renders them from
 * getSettingDefinitions() (which also makes them searchable); older versions
 * call display(), which renders the same list.
 */
export class BetterBacklinksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BetterBacklinksPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		const core = this.plugin.coreDailyNotes;
		const weekly = this.plugin.periodicNotesWeekly;
		return [
			{
				name: "Show backlinks section",
				desc: "Show linking notes at the bottom of every note.",
				control: { type: "toggle", key: "showSection" },
			},
			{
				name: "Default sort order",
				desc: "How cards are ordered. Any note can use its own order, chosen from the sort button in its backlinks header.",
				control: {
					type: "dropdown",
					key: "defaultSort",
					options: Object.fromEntries(SORT_ORDERS.map(({ order, label }) => [order, label])),
				},
			},
			{
				name: "Expand cards by default up to",
				desc: "Cards start expanded when a note has this many backlinks or fewer, and collapsed above that.",
				control: { type: "number", key: "expandUpTo", min: 0, step: 1 },
			},
			{
				name: "Mentions shown per card",
				desc: "Further blocks are hidden behind a row that shows the rest.",
				control: { type: "number", key: "mentionsPerCard", min: 1, step: 1 },
			},
			{
				name: "Highlight matches",
				desc: "Highlight links to this note in excerpts and properties, and the matching part of title-match titles.",
				control: { type: "toggle", key: "highlightMatches" },
			},
			{
				name: "Show in reading view",
				control: { type: "toggle", key: "showInReadingView" },
			},
			{
				name: "Include links in properties",
				desc: "Count links in a note's properties as backlinks. They appear as a row at the top of the card.",
				control: { type: "toggle", key: "includePropertyLinks" },
			},
			{
				name: "Include title matches",
				desc: "Show notes whose title contains this note's name as a whole word, even if they don't link to it. For example, a note titled with a date followed by more words appears under that date's note.",
				control: { type: "toggle", key: "includeTitleMatches" },
			},
			{
				name: "Show unlinked mentions",
				desc: "List notes that mention this note's name as plain text without linking it, in a group below the backlinks, with a button to turn each mention into a link.",
				control: { type: "toggle", key: "showUnlinkedMentions" },
			},
			{
				name: "Show everything in one list",
				desc: "Combine backlinks, notes created that day or week, and unlinked mentions into a single list without group headings. A note that would appear in several groups gets one card.",
				control: { type: "toggle", key: "combineGroups" },
			},
			{
				type: "group",
				heading: "Excluded folders and notes",
				items: [
					{
						name: "Exclude a folder or note",
						desc: "Excluded folders and notes never appear in the backlinks section or sidebar, in any group. Excluding a folder covers every note inside it, including in subfolders. Start typing to pick a folder or note from your vault.",
						aliases: ["excluded folders", "excluded notes", "ignore", "hide"],
						render: (setting) => this.renderExclusionInput(setting),
					},
					...this.exclusionEntries(),
				],
			},
			{
				type: "group",
				heading: "Creation dates",
				items: [
					{
						name: "Created date property",
						desc: "A property that records when a note was created, used instead of the file's date when present. File dates can change when notes are synced, copied or restored. Used by the daily and weekly notes groups.",
						control: { type: "text", key: "createdProperty", placeholder: "created" },
					},
				],
			},
			{
				type: "group",
				heading: "Daily notes",
				items: [
					{
						name: "Show notes created on this day",
						desc: "On a daily note, list the notes created on that day in their own group, each with a preview of how it starts.",
						control: { type: "toggle", key: "showCreatedOnDay" },
					},
					{
						name: "Date format",
						desc: "How daily notes are named. Leave empty to use the format from Obsidian's daily notes settings.",
						control: { type: "text", key: "dailyNoteFormat", placeholder: core.format },
					},
					{
						name: "Folder",
						desc: "Where daily notes are kept. Leave empty to use the folder from Obsidian's daily notes settings.",
						control: { type: "text", key: "dailyNoteFolder", placeholder: core.folder || "Anywhere in the vault" },
					},
				],
			},
			{
				type: "group",
				heading: "Weekly notes",
				items: [
					{
						name: "Show notes created this week",
						desc: "On a weekly note, list the notes created during that week in their own group, each with a preview of how it starts.",
						control: { type: "toggle", key: "showCreatedThisWeek" },
					},
					{
						name: "Week format",
						desc: weekly
							? "How weekly notes are named. Leave empty to use the format from the periodic notes plugin."
							: "How weekly notes are named. Leave empty for ISO weeks, such as 2026-W40.",
						control: { type: "text", key: "weeklyNoteFormat", placeholder: weekly?.format ?? DEFAULT_WEEKLY_FORMAT },
					},
					{
						name: "Folder",
						desc: weekly
							? "Where weekly notes are kept. Leave empty to use the folder from the periodic notes plugin."
							: "Where weekly notes are kept. Leave empty to find them anywhere in the vault.",
						control: {
							type: "text",
							key: "weeklyNoteFolder",
							placeholder: weekly?.folder || "Anywhere in the vault",
						},
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		return this.plugin.settings[key as Key];
	}

	/** Set when an entry was just added, so the redrawn input gets focus back for the next one. */
	private refocusExclusionInput = false;

	/** A text box that suggests the vault's folders and notes as you type; picking one excludes it. */
	private renderExclusionInput(setting: Setting): () => void {
		let suggest: ExclusionSuggest | null = null;
		setting.addText((text) => {
			text.setPlaceholder("Folder or note");
			suggest = new ExclusionSuggest(this.app, text.inputEl, () => this.plugin.exclusions());
			suggest.onSelect((item) => {
				suggest?.close();
				text.setValue("");
				void this.addExclusion(item);
			});
			if (this.refocusExclusionInput) {
				this.refocusExclusionInput = false;
				window.setTimeout(() => text.inputEl.focus(), 0);
			}
		});
		return () => suggest?.close();
	}

	private async addExclusion(item: TFolder | TFile) {
		const key = item instanceof TFolder ? "excludedFolders" : "excludedNotes";
		const path = normalizePath(item.path);
		if (this.plugin.settings[key].includes(path)) return;
		this.plugin.settings[key] = [...this.plugin.settings[key], path];
		this.refocusExclusionInput = true;
		await this.saveExclusions();
	}

	/**
	 * Every excluded folder, then every excluded note, each with a button to
	 * remove it. Entries that no longer exist are labelled, so they can be
	 * told apart and removed.
	 */
	private exclusionEntries(): SettingDefinition<Key>[] {
		const { vault } = this.app;
		const entry = (key: "excludedFolders" | "excludedNotes", path: string, name: string, desc: string) => ({
			name,
			desc,
			render: (setting: Setting) => {
				setting.addExtraButton((button) =>
					button
						.setIcon("x")
						.setTooltip("Remove")
						.onClick(() => {
							this.plugin.settings[key] = this.plugin.settings[key].filter((p) => p !== path);
							void this.saveExclusions();
						}),
				);
			},
		});
		return [
			...this.plugin.settings.excludedFolders.map((path) =>
				entry(
					"excludedFolders",
					path,
					path,
					vault.getFolderByPath(path) ? "Folder, including everything inside it" : "Folder not found in this vault",
				),
			),
			...this.plugin.settings.excludedNotes.map((path) =>
				entry(
					"excludedNotes",
					path,
					path.replace(/\.md$/, ""),
					vault.getFileByPath(path) ? "Note" : "Note not found in this vault",
				),
			),
		];
	}

	private async saveExclusions() {
		await this.plugin.saveSettings();
		this.refresh();
	}

	/** Writes through the plugin, which saves settings alongside its other stored state. */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key as Key) {
			case "dailyNoteFormat":
			case "weeklyNoteFormat":
			case "createdProperty":
				settings[key as "dailyNoteFormat" | "weeklyNoteFormat" | "createdProperty"] = String(value).trim();
				break;
			case "dailyNoteFolder":
			case "weeklyNoteFolder": {
				const folder = String(value).trim();
				settings[key as "dailyNoteFolder" | "weeklyNoteFolder"] = folder ? normalizePath(folder) : "";
				break;
			}
			case "defaultSort":
				if (!isSortOrder(value)) return;
				settings.defaultSort = value;
				break;
			case "expandUpTo":
			case "mentionsPerCard": {
				const n = Math.floor(Number(value));
				const min = key === "mentionsPerCard" ? 1 : 0;
				if (!Number.isFinite(n) || n < min) return;
				settings[key as "expandUpTo" | "mentionsPerCard"] = n;
				break;
			}
			default:
				if (typeof value !== "boolean") return;
				(settings as unknown as Record<string, boolean>)[key] = value;
		}
		await this.plugin.saveSettings();
	}

	/** Redraws the tab if it's showing, so its lists and placeholders show current values. */
	refresh() {
		// Obsidian 1.13+ caches the declarative settings; update() reads them again.
		const tab = this as { update?: () => void };
		if (typeof tab.update === "function") tab.update();
		else if (this.containerEl.isConnected) this.draw();
	}

	/** Fallback for Obsidian before 1.13, rendering the same definitions imperatively. */
	override display() {
		this.draw();
	}

	private draw() {
		const { containerEl } = this;
		containerEl.empty();
		for (const item of this.getSettingDefinitions()) {
			if ("type" in item && item.type === "group") {
				if (item.heading) new Setting(containerEl).setName(item.heading).setHeading();
				for (const child of item.items ?? []) this.renderControl(child);
			} else {
				this.renderControl(item as SettingDefinition<Key>);
			}
		}
	}

	private renderControl(definition: SettingDefinition<Key>) {
		const { containerEl } = this;
		if ("render" in definition && definition.render) {
			const setting = new Setting(containerEl).setName(definition.name);
			if (typeof definition.desc === "string") setting.setDesc(definition.desc);
			// Only Obsidian 1.13+ has setting groups, and these rows don't use one.
			definition.render(setting, undefined as never);
			return;
		}
		if (!("control" in definition) || !definition.control) {
			// A row with only a name and description.
			const setting = new Setting(containerEl).setName(definition.name);
			if (typeof definition.desc === "string") setting.setDesc(definition.desc);
			return;
		}
		const { control } = definition;
		const setting = new Setting(containerEl).setName(definition.name);
		if (typeof definition.desc === "string") setting.setDesc(definition.desc);
		const current = this.getControlValue(control.key);
		const save = (value: unknown) => void this.setControlValue(control.key, value);

		switch (control.type) {
			case "toggle":
				setting.addToggle((toggle) => toggle.setValue(current === true).onChange(save));
				break;
			case "dropdown":
				setting.addDropdown((dropdown) =>
					dropdown.addOptions(control.options).setValue(String(current)).onChange(save),
				);
				break;
			case "number":
				setting.addText((text) => {
					text.inputEl.type = "number";
					text.setValue(String(current)).onChange(save);
				});
				break;
			case "textarea":
				setting.addTextArea((text) =>
					text
						.setPlaceholder(control.placeholder ?? "")
						.setValue(String(current))
						.onChange(save),
				);
				break;
			case "text":
				setting.addText((text) =>
					text
						.setPlaceholder(control.placeholder ?? "")
						.setValue(String(current))
						.onChange(save),
				);
				break;
		}
	}
}

/**
 * Suggests folders and notes matching what's typed, best match first. Leaves
 * out ones already excluded, including notes and folders inside an excluded
 * folder.
 */
class ExclusionSuggest extends AbstractInputSuggest<TFolder | TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly exclusions: () => Exclusions,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): (TFolder | TFile)[] {
		const excluded = this.exclusions();
		const { vault } = this.app;
		const candidates = [
			...vault.getAllFolders(false).filter(
				(folder) => !excluded.folders.includes(folder.path) && !isExcluded(folder.path, excluded),
			),
			...vault.getMarkdownFiles().filter((file) => !isExcluded(file.path, excluded)),
		];
		const search = prepareFuzzySearch(query.trim());
		const scored: { item: TFolder | TFile; score: number }[] = [];
		for (const item of candidates) {
			const result = query.trim() ? search(label(item)) : { score: 0, matches: [] };
			if (result) scored.push({ item, score: result.score });
		}
		// Higher scores are better matches; ties go folders first, then by path.
		return scored
			.sort(
				(a, b) =>
					b.score - a.score ||
					Number(a.item instanceof TFile) - Number(b.item instanceof TFile) ||
					a.item.path.localeCompare(b.item.path),
			)
			.map(({ item }) => item);
	}

	renderSuggestion(item: TFolder | TFile, el: HTMLElement) {
		const text = label(item);
		el.addClass("mod-complex");
		const titleEl = el.createDiv({ cls: "suggestion-content" }).createDiv({ cls: "suggestion-title" });
		const result: SearchResult | null = prepareFuzzySearch(this.getValue().trim())(text);
		if (result) renderResults(titleEl, text, result);
		else titleEl.setText(text);
		const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
		setIcon(flair, item instanceof TFolder ? "folder" : "file-text");
		flair.setAttribute("aria-label", item instanceof TFolder ? "Folder" : "Note");
	}
}

/** How a folder or note is shown: its path, without .md for notes. */
function label(item: TFolder | TFile): string {
	return item instanceof TFile ? item.path.replace(/\.md$/, "") : item.path;
}

import {
	normalizePath,
	PluginSettingTab,
	Setting,
	type App,
	type SettingDefinition,
	type SettingDefinitionItem,
} from "obsidian";
import type BetterBacklinksPlugin from "./main";
import type { BetterBacklinksSettings } from "./settings";
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
				name: "Excluded folders",
				desc: "Notes in these folders never appear as backlinks, for example your templates folder. One folder per line.",
				control: { type: "textarea", key: "excludedFolders", placeholder: "Templates" },
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
					{
						name: "Created date property",
						desc: "A property that records when a note was created, used instead of the file's date when present. File dates can change when notes are synced, copied or restored.",
						control: { type: "text", key: "createdProperty", placeholder: "created" },
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as Key];
		return Array.isArray(value) ? value.join("\n") : value;
	}

	/** Writes through the plugin, which saves settings alongside its other stored state. */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key as Key) {
			case "excludedFolders":
				settings.excludedFolders = String(value)
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.map((folder) => normalizePath(folder));
				break;
			case "dailyNoteFormat":
			case "createdProperty":
				settings[key as "dailyNoteFormat" | "createdProperty"] = String(value).trim();
				break;
			case "dailyNoteFolder": {
				const folder = String(value).trim();
				settings.dailyNoteFolder = folder ? normalizePath(folder) : "";
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

	/** Fallback for Obsidian before 1.13, rendering the same definitions imperatively. */
	override display() {
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
		if (!("control" in definition) || !definition.control) return;
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

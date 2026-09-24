import { PluginSettingTab, Setting, type App } from "obsidian";
import type BetterBacklinksPlugin from "./main";

export class BetterBacklinksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BetterBacklinksPlugin,
	) {
		super(app, plugin);
	}

	override display() {
		const { containerEl, plugin } = this;
		const { settings } = plugin;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show backlinks section")
			.setDesc("Show linking notes at the bottom of every note.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showSection).onChange(async (value) => {
					settings.showSection = value;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Expand cards by default up to")
			.setDesc("Cards start expanded when a note has this many backlinks or fewer, and collapsed above that.")
			.addText((text) =>
				text.setValue(String(settings.expandUpTo)).onChange(async (value) => {
					const n = Number.parseInt(value, 10);
					if (!Number.isFinite(n) || n < 0) return;
					settings.expandUpTo = n;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Mentions shown per card")
			.setDesc('The rest sit behind "+N more mentions".')
			.addText((text) =>
				text.setValue(String(settings.mentionsPerCard)).onChange(async (value) => {
					const n = Number.parseInt(value, 10);
					if (!Number.isFinite(n) || n < 1) return;
					settings.mentionsPerCard = n;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Highlight matches")
			.setDesc("Highlight links to this note in excerpts and properties, and the matching part of title-match titles.")
			.addToggle((toggle) =>
				toggle.setValue(settings.highlightMatches).onChange(async (value) => {
					settings.highlightMatches = value;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Show in Reading view").addToggle((toggle) =>
			toggle.setValue(settings.showInReadingView).onChange(async (value) => {
				settings.showInReadingView = value;
				await plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("Include links in properties")
			.setDesc("Count links in a note's properties, such as related: [[Note]], as backlinks. They appear as a row at the top of the card.")
			.addToggle((toggle) =>
				toggle.setValue(settings.includePropertyLinks).onChange(async (value) => {
					settings.includePropertyLinks = value;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Include title matches")
			.setDesc(
				'Show notes whose title contains this note\'s name as a whole word, even if they don\'t link to it. For example, "2026-09-24 Meeting with Joe" appears under "2026-09-24".',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.includeTitleMatches).onChange(async (value) => {
					settings.includeTitleMatches = value;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Notes in these folders are never shown as backlinks, e.g. templates. One folder per line.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Templates")
					.setValue(settings.excludedFolders.join("\n"))
					.onChange(async (value) => {
						settings.excludedFolders = value
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean);
						await plugin.saveSettings();
					}),
			);
	}
}

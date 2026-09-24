import { debounce, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { rememberSection } from "./navigate";
import { pulseExtension } from "./pulse";
import { BetterBacklinksSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, type BetterBacklinksSettings } from "./settings";
import { BacklinksSection, HOVER_SOURCE } from "./view";

interface PluginData {
	settings: BetterBacklinksSettings;
	/** Collapse state per card, keyed by `collapseKey(current note, source note)`. */
	collapsed: Record<string, boolean>;
	coreNoticeShown: boolean;
}

// Paths can't contain a newline, so it safely separates the parts of a key:
// the current note, the source note, and for unlinked cards a trailing "unlinked".
const collapseKey = (target: string, source: string) => `${target}\n${source}`;

export default class BetterBacklinksPlugin extends Plugin {
	override settings: BetterBacklinksSettings = { ...DEFAULT_SETTINGS };
	private collapsed: Record<string, boolean> = {};
	private coreNoticeShown = false;
	private readonly sections = new Map<MarkdownView, BacklinksSection>();

	private readonly refreshAll = debounce(
		() => {
			for (const section of this.sections.values()) section.refresh();
		},
		200,
		true,
	);
	private readonly saveSoon = debounce(() => void this.persist(), 500, true);

	override async onload() {
		const data: Partial<PluginData> = (await this.loadData()) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		this.collapsed = data.collapsed ?? {};
		this.coreNoticeShown = data.coreNoticeShown ?? false;

		this.registerEditorExtension(pulseExtension);
		this.registerMarkdownPostProcessor((el, ctx) => rememberSection(el, ctx));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Better Backlinks", defaultMod: true });
		this.addSettingTab(new BetterBacklinksSettingTab(this.app, this));
		this.addCommand({
			id: "toggle-section",
			name: "Toggle backlinks section",
			callback: async () => {
				this.settings.showSection = !this.settings.showSection;
				await this.saveSettings();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			this.pruneCollapsed();
			this.syncViews();
			this.showCoreNotice();

			const { workspace, metadataCache, vault } = this.app;
			this.registerEvent(workspace.on("layout-change", () => this.syncViews()));
			this.registerEvent(workspace.on("active-leaf-change", () => this.syncViews()));
			this.registerEvent(workspace.on("file-open", () => this.syncViews()));
			this.registerEvent(metadataCache.on("resolved", () => this.refreshAll()));
			this.registerEvent(
				metadataCache.on("changed", (file) => {
					this.refreshAll();
					// Only this note's text changed, so only it needs checking for unlinked mentions.
					for (const section of this.sections.values()) void section.recheckUnlinked(file);
				}),
			);
			// A new or renamed note can be a title match before it has any links.
			this.registerEvent(vault.on("create", () => this.refreshAll()));
			this.registerEvent(
				vault.on("delete", (file) => {
					for (const section of this.sections.values()) section.forgetUnlinked(file.path);
					this.refreshAll();
				}),
			);
			this.registerEvent(
				vault.on("rename", (file, oldPath) => {
					if (file instanceof TFile) this.renameCollapsed(oldPath, file.path);
					for (const section of this.sections.values()) {
						section.forgetUnlinked(oldPath);
						if (file instanceof TFile) void section.recheckUnlinked(file);
					}
					this.syncViews();
					this.refreshAll();
				}),
			);
		});
	}

	override onunload() {
		// Sections are child components, so unloading the plugin removes their DOM.
		this.sections.clear();
	}

	async saveSettings() {
		await this.persist();
		for (const section of this.sections.values()) section.rerender();
	}

	getCollapsed(target: string, source: string): boolean | undefined {
		return this.collapsed[collapseKey(target, source)];
	}

	setCollapsed(target: string, entries: [source: string, collapsed: boolean][]) {
		for (const [source, collapsed] of entries) this.collapsed[collapseKey(target, source)] = collapsed;
		this.saveSoon();
		// Every pane showing this note, including the one that changed, follows the stored state.
		for (const section of this.sections.values()) {
			if (section.getTarget()?.path === target) section.syncCollapsed();
		}
	}

	/** Gives every open markdown view a section, and drops sections whose view closed. */
	private syncViews() {
		const views = new Set<MarkdownView>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const view = leaf.view;
			views.add(view);
			let section = this.sections.get(view);
			if (!section) {
				section = this.addChild(new BacklinksSection(this, view));
				this.sections.set(view, section);
			}
			section.sync();
		}
		for (const [view, section] of this.sections) {
			if (views.has(view)) continue;
			this.removeChild(section);
			this.sections.delete(view);
		}
	}

	private async persist() {
		const data: PluginData = {
			settings: this.settings,
			collapsed: this.collapsed,
			coreNoticeShown: this.coreNoticeShown,
		};
		await this.saveData(data);
	}

	private pruneCollapsed() {
		const exists = (path: string) => this.app.vault.getFileByPath(path) !== null;
		let changed = false;
		for (const key of Object.keys(this.collapsed)) {
			const [target = "", source = ""] = key.split("\n");
			if (exists(target) && exists(source)) continue;
			delete this.collapsed[key];
			changed = true;
		}
		if (changed) this.saveSoon();
	}

	private renameCollapsed(oldPath: string, newPath: string) {
		let changed = false;
		for (const [key, value] of Object.entries(this.collapsed)) {
			const [target = "", source = "", ...rest] = key.split("\n");
			if (target !== oldPath && source !== oldPath) continue;
			delete this.collapsed[key];
			const renamed = [target === oldPath ? newPath : target, source === oldPath ? newPath : source, ...rest];
			this.collapsed[renamed.join("\n")] = value;
			changed = true;
		}
		if (changed) this.saveSoon();
	}

	private showCoreNotice() {
		if (this.coreNoticeShown) return;
		new Notice(
			'Better Backlinks: to avoid two backlink lists, turn off "Show backlinks at the bottom of notes" in Settings → Core plugins → Backlinks.',
			15000,
		);
		this.coreNoticeShown = true;
		void this.persist();
	}
}

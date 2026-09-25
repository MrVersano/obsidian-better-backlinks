import { debounce, MarkdownView, normalizePath, Notice, Plugin, TFile } from "obsidian";
import { obsidianMoment } from "./backlink-index";
import { dailyNoteDay, DEFAULT_DAILY_FORMAT, type DailyNoteConfig, type Day } from "./daily-notes";
import { rememberSection } from "./navigate";
import { pulseExtension } from "./pulse";
import { BetterBacklinksSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, type BetterBacklinksSettings } from "./settings";
import { isSortOrder, type SortOrder } from "./sort";
import { HOVER_SOURCE, type BacklinksPanel } from "./panel";
import { BacklinksSidebarView, SIDEBAR_VIEW } from "./sidebar";
import { BacklinksSection } from "./view";

interface PluginData {
	settings: BetterBacklinksSettings;
	/** Collapse state per card, keyed by `collapseKey(current note, source note)`. */
	collapsed: Record<string, boolean>;
	/** Sort order chosen for a note from its sort menu, by note path; absent means the default. */
	sortOrders: Record<string, SortOrder>;
	coreNoticeShown: boolean;
}

// Paths can't contain a newline, so it safely separates the parts of a key:
// the current note, the source note, and for unlinked cards a trailing "unlinked".
const collapseKey = (target: string, source: string) => `${target}\n${source}`;

export default class BetterBacklinksPlugin extends Plugin {
	override settings: BetterBacklinksSettings = { ...DEFAULT_SETTINGS };
	private collapsed: Record<string, boolean> = {};
	private sortOrders: Record<string, SortOrder> = {};
	private coreNoticeShown = false;
	private readonly sections = new Map<MarkdownView, BacklinksSection>();
	/** Format and folder from Obsidian's core Daily notes plugin, read from its settings file. */
	coreDailyNotes: DailyNoteConfig = { format: DEFAULT_DAILY_FORMAT, folder: "" };

	private readonly refreshAll = debounce(
		() => {
			for (const panel of this.panels()) panel.refresh();
		},
		200,
		true,
	);
	private readonly saveSoon = debounce(() => void this.persist(), 500, true);

	override async onload() {
		const data = ((await this.loadData()) as Partial<PluginData> | null) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		this.collapsed = data.collapsed ?? {};
		this.sortOrders = Object.fromEntries(
			Object.entries(data.sortOrders ?? {}).filter((entry): entry is [string, SortOrder] => isSortOrder(entry[1])),
		);
		this.coreNoticeShown = data.coreNoticeShown ?? false;

		this.registerEditorExtension(pulseExtension);
		this.registerMarkdownPostProcessor((el, ctx) => rememberSection(el, ctx));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Better Backlinks", defaultMod: true });
		this.addSettingTab(new BetterBacklinksSettingTab(this.app, this));
		this.registerView(SIDEBAR_VIEW, (leaf) => new BacklinksSidebarView(leaf, this));
		this.addRibbonIcon("gallery-vertical-end", "Open backlinks sidebar", () => void this.openSidebar());
		this.addCommand({
			id: "open-sidebar",
			name: "Open sidebar",
			callback: () => void this.openSidebar(),
		});
		this.addCommand({
			id: "toggle-section",
			name: "Toggle backlinks section",
			callback: async () => {
				this.settings.showSection = !this.settings.showSection;
				await this.saveSettings();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			this.pruneSavedState();
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
					for (const panel of this.panels()) void panel.recheckUnlinked(file);
				}),
			);
			// A new or renamed note can be a title match before it has any links.
			this.registerEvent(vault.on("create", () => this.refreshAll()));
			this.registerEvent(
				vault.on("delete", (file) => {
					for (const panel of this.panels()) panel.forgetUnlinked(file.path);
					this.refreshAll();
				}),
			);
			this.registerEvent(
				vault.on("rename", (file, oldPath) => {
					if (file instanceof TFile) this.renameSavedState(oldPath, file.path);
					for (const panel of this.panels()) {
						panel.forgetUnlinked(oldPath);
						if (file instanceof TFile) void panel.recheckUnlinked(file);
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
		for (const view of this.sidebarViews()) view.rerender();
	}

	/** The order for cards under `target`: its own if one was chosen, else the default. */
	getSort(target: string): SortOrder {
		return this.sortOrders[target] ?? this.settings.defaultSort;
	}

	/** True when `target` has its own order rather than following the default. */
	hasOwnSort(target: string): boolean {
		return target in this.sortOrders;
	}

	/**
	 * Sets the order for cards under `target`, or clears it with null. Choosing
	 * the default clears it too, so a later change to the default still applies.
	 */
	setSort(target: string, order: SortOrder | null) {
		if (order === null || order === this.settings.defaultSort) delete this.sortOrders[target];
		else this.sortOrders[target] = order;
		this.saveSoon();
		for (const panel of this.panels()) {
			if (panel.getTarget()?.path === target) panel.resort();
		}
	}

	/** The daily note settings in effect: this plugin's overrides, else Obsidian's. */
	dailyNoteConfig(): DailyNoteConfig {
		const { dailyNoteFormat, dailyNoteFolder } = this.settings;
		const folder = dailyNoteFolder.trim() || this.coreDailyNotes.folder;
		return {
			format: dailyNoteFormat.trim() || this.coreDailyNotes.format,
			folder: folder ? normalizePath(folder) : "",
		};
	}

	/** The day `file` is the daily note for, when "created on this day" is on; else null. */
	dailyNoteDay(file: TFile): Day | null {
		if (!this.settings.showCreatedOnDay) return null;
		return dailyNoteDay(file.path, this.dailyNoteConfig(), obsidianMoment);
	}

	private loadingCoreDailyNotes: Promise<void> | null = null;

	/** Re-reads Obsidian's Daily notes settings; overlapping calls share one read. */
	private loadCoreDailyNotes(): Promise<void> {
		this.loadingCoreDailyNotes ??= this.readCoreDailyNotes().finally(() => {
			this.loadingCoreDailyNotes = null;
		});
		return this.loadingCoreDailyNotes;
	}

	/**
	 * Reads Obsidian's core Daily notes settings (.obsidian/daily-notes.json).
	 * Missing or unreadable settings mean Obsidian's defaults.
	 */
	private async readCoreDailyNotes() {
		const next: DailyNoteConfig = { format: DEFAULT_DAILY_FORMAT, folder: "" };
		try {
			const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
			if (await this.app.vault.adapter.exists(path)) {
				const data = JSON.parse(await this.app.vault.adapter.read(path)) as { format?: unknown; folder?: unknown };
				if (typeof data.format === "string" && data.format.trim()) next.format = data.format.trim();
				if (typeof data.folder === "string") next.folder = data.folder.trim();
			}
		} catch {
			// Keep the defaults.
		}
		if (next.format === this.coreDailyNotes.format && next.folder === this.coreDailyNotes.folder) return;
		this.coreDailyNotes = next;
		for (const panel of this.panels()) panel.refresh();
	}

	getCollapsed(target: string, source: string): boolean | undefined {
		return this.collapsed[collapseKey(target, source)];
	}

	setCollapsed(target: string, entries: [source: string, collapsed: boolean][]) {
		for (const [source, collapsed] of entries) this.collapsed[collapseKey(target, source)] = collapsed;
		this.saveSoon();
		// Every pane showing this note, including the one that changed, follows the stored state.
		for (const panel of this.panels()) {
			if (panel.getTarget()?.path === target) panel.syncCollapsed();
		}
	}

	/** Every open backlinks panel: one per note's bottom section, one per sidebar view. */
	private panels(): BacklinksPanel[] {
		return [...[...this.sections.values()].map((s) => s.panel), ...this.sidebarViews().map((v) => v.panel)];
	}

	private sidebarViews(): BacklinksSidebarView[] {
		return this.app.workspace
			.getLeavesOfType(SIDEBAR_VIEW)
			.map((leaf) => leaf.view)
			.filter((view): view is BacklinksSidebarView => view instanceof BacklinksSidebarView);
	}

	/** Opens the sidebar in the right sidebar, or reveals it if it's already open. */
	private async openSidebar() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(SIDEBAR_VIEW)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: SIDEBAR_VIEW, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** Gives every open markdown view a section, drops sections whose view closed, and points sidebars at the active note. */
	private syncViews() {
		// Obsidian's Daily notes settings live outside the vault's files and send
		// no events, so re-read them whenever the views change.
		void this.loadCoreDailyNotes();
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
		const active = this.app.workspace.getActiveFile();
		for (const view of this.sidebarViews()) view.follow(active);
	}

	private async persist() {
		const data: PluginData = {
			settings: this.settings,
			collapsed: this.collapsed,
			sortOrders: this.sortOrders,
			coreNoticeShown: this.coreNoticeShown,
		};
		await this.saveData(data);
	}

	private pruneSavedState() {
		const exists = (path: string) => this.app.vault.getFileByPath(path) !== null;
		let changed = false;
		for (const key of Object.keys(this.collapsed)) {
			const [target = "", source = ""] = key.split("\n");
			if (exists(target) && exists(source)) continue;
			delete this.collapsed[key];
			changed = true;
		}
		for (const path of Object.keys(this.sortOrders)) {
			if (exists(path)) continue;
			delete this.sortOrders[path];
			changed = true;
		}
		if (changed) this.saveSoon();
	}

	private renameSavedState(oldPath: string, newPath: string) {
		let changed = false;
		for (const [key, value] of Object.entries(this.collapsed)) {
			const [target = "", source = "", ...rest] = key.split("\n");
			if (target !== oldPath && source !== oldPath) continue;
			delete this.collapsed[key];
			const renamed = [target === oldPath ? newPath : target, source === oldPath ? newPath : source, ...rest];
			this.collapsed[renamed.join("\n")] = value;
			changed = true;
		}
		const sort = this.sortOrders[oldPath];
		if (sort) {
			delete this.sortOrders[oldPath];
			this.sortOrders[newPath] = sort;
			changed = true;
		}
		if (changed) this.saveSoon();
	}

	private showCoreNotice() {
		if (this.coreNoticeShown) return;
		new Notice(
			"To avoid seeing backlinks twice, turn off the core backlinks plugin's option to show backlinks at the bottom of notes.",
			15000,
		);
		this.coreNoticeShown = true;
		void this.persist();
	}
}

// The sidebar host: an Obsidian view that shows the backlinks panel for the
// active note, like Obsidian's own Backlinks pane.

import { ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import type BetterBacklinksPlugin from "./main";
import { BacklinksPanel } from "./panel";

export const SIDEBAR_VIEW = "better-backlinks-sidebar";

export class BacklinksSidebarView extends ItemView {
	readonly panel: BacklinksPanel;
	private readonly emptyEl: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		plugin: BetterBacklinksPlugin,
	) {
		super(leaf);
		this.emptyEl = createDiv({ cls: "better-backlinks-sidebar-empty" });
		this.panel = new BacklinksPanel(plugin, {
			isLive: () => true,
			onRender: (shown) => this.showEmpty(shown ? null : "No backlinks for this note."),
		});
	}

	override getViewType() {
		return SIDEBAR_VIEW;
	}

	override getDisplayText() {
		return "Better backlinks";
	}

	override getIcon() {
		return "gallery-vertical-end";
	}

	override async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("better-backlinks-sidebar");
		this.contentEl.append(this.emptyEl, this.panel.el);
		this.addChild(this.panel);
		this.follow(this.app.workspace.getActiveFile());
	}

	override async onClose() {
		this.removeChild(this.panel);
	}

	/**
	 * Shows `file`'s backlinks. A view with no file (a graph, say) keeps the
	 * last note, so the sidebar doesn't blank while you glance elsewhere; other
	 * file types have no backlinks to show.
	 */
	follow(file: TFile | null) {
		if (!file) {
			if (!this.panel.getTarget()) this.showEmpty("Open a note to see its backlinks.");
			return;
		}
		if (file.extension !== "md") {
			this.panel.setTarget(null);
			this.showEmpty("Open a note to see its backlinks.");
			return;
		}
		this.panel.setTarget(file);
		this.panel.refresh();
	}

	/** Rebuilds every card, e.g. after a settings change. */
	rerender() {
		this.panel.rerender();
		if (!this.panel.getTarget()) this.follow(this.app.workspace.getActiveFile());
	}

	private showEmpty(message: string | null) {
		this.emptyEl.toggle(message !== null);
		this.emptyEl.setText(message ?? "");
		this.panel.el.toggle(message === null);
	}
}

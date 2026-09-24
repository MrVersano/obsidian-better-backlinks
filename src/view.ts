// The Backlinks section: a plain DOM element mounted after a MarkdownView's
// content, inside its scroller, outside the editable document.

import {
	Component,
	Keymap,
	MarkdownRenderer,
	Menu,
	MarkdownView,
	setIcon,
	type HoverParent,
	type HoverPopover,
	type TFile,
} from "obsidian";
import {
	findBacklinkSources,
	findUnlinked,
	isExcluded,
	loadExcerpts,
	mentionCount,
	resolvesTo,
	scanUnlinked,
	type BacklinkSource,
} from "./backlink-index";
import { UNLINKED_CLASS, type Excerpt, type Mention } from "./excerpt";
import { formatAge, plural, toggleTask } from "./format";
import { linkMentions } from "./link-mention";
import type BetterBacklinksPlugin from "./main";
import { openMention, openProperty } from "./navigate";
import { propertyRows } from "./properties";
import { compareBy, SORT_ORDERS, sortLabel } from "./sort";

export const HOVER_SOURCE = "better-backlinks";

type Mode = "source" | "preview";

export class BacklinksSection extends Component implements HoverParent {
	hoverPopover: HoverPopover | null = null;

	private readonly rootEl: HTMLElement;
	private readonly countEl: HTMLElement;
	private readonly toggleAllEl: HTMLElement;
	private readonly sortEl: HTMLElement;
	private readonly cardsEl: HTMLElement;
	private readonly cards = new Map<string, Card>();
	private readonly unlinkedGroupEl: HTMLElement;
	private readonly unlinkedCountEl: HTMLElement;
	private readonly unlinkedCardsEl: HTMLElement;
	private readonly unlinkedCards = new Map<string, Card>();
	private linkedSources: BacklinkSource[] = [];
	/** Unlinked mentions found so far, by source path; filled by the scan and kept fresh per note. */
	private readonly unlinkedSources = new Map<string, BacklinkSource>();
	/** What the last unlinked scan was for; a change (note, name, settings) starts a new one. */
	private scanKey = "";
	private scanToken = 0;
	private readonly resizeObserver: ResizeObserver;
	private readonly modeObserver: MutationObserver;
	private target: TFile | null = null;
	private mode: Mode | null = null;
	private mountRetry = 0;
	private mountRetryFrame = 0;
	private measureFrame = 0;

	constructor(
		readonly plugin: BetterBacklinksPlugin,
		readonly view: MarkdownView,
	) {
		super();
		this.rootEl = createDiv({ cls: "better-backlinks" });
		this.rootEl.hide();
		const panelEl = this.rootEl.createDiv({ cls: "better-backlinks-panel" });
		const headerEl = panelEl.createDiv({ cls: "better-backlinks-header" });
		headerEl.createDiv({ cls: "better-backlinks-title", text: "Backlinks" });
		this.countEl = headerEl.createDiv({ cls: "better-backlinks-count" });
		this.sortEl = headerEl.createDiv({ cls: "better-backlinks-sort clickable-icon", attr: { role: "button", tabindex: "0" } });
		setIcon(this.sortEl, "arrow-up-narrow-wide");
		this.toggleAllEl = headerEl.createEl("button", { cls: "better-backlinks-toggle-all" });
		this.cardsEl = panelEl.createDiv({ cls: "better-backlinks-cards" });
		this.unlinkedGroupEl = panelEl.createDiv({ cls: "better-backlinks-group" });
		this.unlinkedGroupEl.hide();
		const groupHeaderEl = this.unlinkedGroupEl.createDiv({ cls: "better-backlinks-header" });
		groupHeaderEl.createDiv({ cls: "better-backlinks-title", text: "Unlinked mentions" });
		this.unlinkedCountEl = groupHeaderEl.createDiv({ cls: "better-backlinks-count" });
		this.unlinkedCardsEl = this.unlinkedGroupEl.createDiv({ cls: "better-backlinks-cards" });
		// Measuring changes the observed elements' size, so defer it a frame to
		// stay out of the observer's own loop.
		this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
		// Switching between editing and Reading view only toggles `display` on
		// the two sub-views and fires no workspace event, so watch for it.
		this.modeObserver = new MutationObserver(() => this.sync());
	}

	get app() {
		return this.plugin.app;
	}

	override onload() {
		this.registerDomEvent(this.toggleAllEl, "click", () => this.toggleAll());
		this.registerDomEvent(this.sortEl, "click", (evt) => this.showSortMenu(evt));
		this.registerDomEvent(this.sortEl, "keydown", (evt) => {
			if (evt.key !== "Enter" && evt.key !== " ") return;
			evt.preventDefault();
			const rect = this.sortEl.getBoundingClientRect();
			this.showSortMenu(null, { x: rect.left, y: rect.bottom });
		});
		this.registerDomEvent(this.rootEl, "click", (evt) => this.onClick(evt));
		this.registerDomEvent(this.rootEl, "mouseover", (evt) => this.onHover(evt));
		for (const child of Array.from(this.view.contentEl.children)) {
			this.modeObserver.observe(child, { attributes: true, attributeFilter: ["style"] });
		}
	}

	override onunload() {
		this.scanToken++;
		cancelAnimationFrame(this.mountRetryFrame);
		cancelAnimationFrame(this.measureFrame);
		this.modeObserver.disconnect();
		this.resizeObserver.disconnect();
		this.clearCards();
		this.rootEl.remove();
		this.view.contentEl.removeClass("better-backlinks-shown");
	}

	/** Mounts the section in the right place for the view's mode and file, then refreshes it. */
	sync() {
		const { settings } = this.plugin;
		const file = this.view.file;
		const mode = this.view.getMode() as Mode;
		const enabled =
			settings.showSection && file?.extension === "md" && (mode === "source" || settings.showInReadingView);

		if (!enabled || !file) {
			this.detach();
			return;
		}
		cancelAnimationFrame(this.mountRetryFrame);
		this.rootEl.toggleClass("is-plain", !settings.highlightMatches);
		if (!this.mount(mode)) {
			// Reading view builds its footer after rendering; try again next frame.
			this.detach();
			if (this.mountRetry++ < 120) this.mountRetryFrame = requestAnimationFrame(() => this.sync());
			return;
		}
		this.mountRetry = 0;
		if (file !== this.target) {
			this.clearCards();
			this.target = file;
			this.linkedSources = [];
		}
		this.refresh();
	}

	/** Recomputes the backlinks; only cards whose source changed are re-rendered. */
	refresh() {
		const target = this.target;
		if (!target || !this.rootEl.isConnected) return;

		const { excludedFolders, includePropertyLinks, includeTitleMatches } = this.plugin.settings;
		const sources = findBacklinkSources(this.app, target, {
			excludedFolders,
			includePropertyLinks,
			includeTitleMatches,
		});
		this.linkedSources = sources;
		this.startUnlinkedScan(target);
		this.render();
	}

	/** Re-checks one note for unlinked mentions after it changed or was created. */
	async recheckUnlinked(file: TFile) {
		const target = this.target;
		const { showUnlinkedMentions, excludedFolders } = this.plugin.settings;
		if (!target || !showUnlinkedMentions || file === target || file.extension !== "md") return;
		const source = isExcluded(file.path, excludedFolders) ? null : await findUnlinked(this.app, file, target);
		if (target !== this.target) return;
		if (source) this.unlinkedSources.set(file.path, source);
		else if (!this.unlinkedSources.delete(file.path)) return;
		this.render();
	}

	/** Drops a note that was deleted or renamed away from the unlinked group. */
	forgetUnlinked(path: string) {
		if (this.unlinkedSources.delete(path)) this.render();
	}

	private startUnlinkedScan(target: TFile) {
		const { showUnlinkedMentions, excludedFolders } = this.plugin.settings;
		const key = showUnlinkedMentions ? [target.path, target.basename, ...excludedFolders].join("\n") : "";
		if (key === this.scanKey) return;
		this.scanKey = key;
		const token = ++this.scanToken;
		this.unlinkedSources.clear();
		if (!showUnlinkedMentions) return;
		void scanUnlinked(
			this.app,
			target,
			excludedFolders,
			(found) => {
				for (const source of found) this.unlinkedSources.set(source.file.path, source);
				if (found.length > 0) this.render();
			},
			() => token !== this.scanToken,
		);
	}

	/** Shows the linked cards and, below them, the unlinked-mention cards. */
	private render() {
		const target = this.target;
		if (!target || !this.rootEl.isConnected) return;
		const compare = compareBy(this.plugin.getSort(target.path));
		const linked = [...this.linkedSources].sort(compare);
		const unlinked = [...this.unlinkedSources.values()].sort(compare);
		this.sortEl.setAttr("aria-label", `Sort: ${sortLabel(this.plugin.getSort(target.path))}`);

		const shown = linked.length > 0 || unlinked.length > 0;
		// Obsidian's scroll-past-end padding would sit between the note and the panel.
		this.view.contentEl.toggleClass("better-backlinks-shown", shown);
		if (!shown) {
			this.clearCards();
			this.rootEl.hide();
			return;
		}
		this.rootEl.show();
		this.countEl.toggle(linked.length > 0);
		this.countEl.setText(plural(linked.length, "note"));
		this.syncCards(this.cards, this.cardsEl, linked, linked.length <= this.plugin.settings.expandUpTo);

		this.unlinkedGroupEl.toggle(unlinked.length > 0);
		this.unlinkedCountEl.setText(plural(unlinked.length, "note"));
		// Unlinked mentions are suggestions, so their cards start collapsed.
		this.syncCards(this.unlinkedCards, this.unlinkedCardsEl, unlinked, false);

		this.updateToggleAll();
		this.measure();
	}

	/** Brings one group's cards in line with `sources`: adds, updates, reorders and removes. */
	private syncCards(cards: Map<string, Card>, containerEl: HTMLElement, sources: BacklinkSource[], expandByDefault: boolean) {
		const target = this.target;
		if (!target) return;
		const seen = new Set<string>();
		sources.forEach((source, index) => {
			const path = source.file.path;
			seen.add(path);
			let card = cards.get(path);
			if (!card) {
				const collapsed = this.plugin.getCollapsed(target.path, collapseId(source));
				card = this.addChild(new Card(this, source, collapsed === undefined ? expandByDefault : !collapsed));
				cards.set(path, card);
			} else {
				card.update(source);
			}
			// Keep DOM order in step with the sort order.
			if (containerEl.children[index] !== card.el) containerEl.insertBefore(card.el, containerEl.children[index] ?? null);
		});
		for (const [path, card] of cards) {
			if (seen.has(path)) continue;
			this.removeChild(card);
			cards.delete(path);
		}
	}

	/** Applies stored collapse state, e.g. after the same note's cards changed in another pane. */
	syncCollapsed() {
		if (!this.target) return;
		for (const card of [...this.cards.values(), ...this.unlinkedCards.values()]) {
			const collapsed = this.plugin.getCollapsed(this.target.path, collapseId(card.source));
			if (collapsed !== undefined) card.setExpanded(!collapsed);
		}
		this.updateToggleAll();
	}

	/** Re-orders the cards after this note's sort order changed. */
	resort() {
		this.render();
	}

	/** Whether cards show their created date rather than their modified date. */
	get showsCreated(): boolean {
		return this.target !== null && this.plugin.getSort(this.target.path).startsWith("created");
	}

	private showSortMenu(evt: MouseEvent | null, position?: { x: number; y: number }) {
		const target = this.target;
		if (!target) return;
		const current = this.plugin.getSort(target.path);
		const menu = new Menu();
		for (const { order, label } of SORT_ORDERS) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(order === current)
					.onClick(() => this.plugin.setSort(target.path, order)),
			);
		}
		if (this.plugin.hasOwnSort(target.path)) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(`Use default: ${sortLabel(this.plugin.settings.defaultSort)}`)
					.setIcon("rotate-ccw")
					.onClick(() => this.plugin.setSort(target.path, null)),
			);
		}
		if (evt) menu.showAtMouseEvent(evt);
		else if (position) menu.showAtPosition(position);
	}

	/** Re-renders every card, e.g. after a settings change. */
	rerender() {
		this.clearCards();
		this.sync();
	}

	getTarget(): TFile | null {
		return this.target;
	}

	onCardToggled(card: Card) {
		if (this.target) this.plugin.setCollapsed(this.target.path, [[collapseId(card.source), !card.expanded]]);
	}

	private mount(mode: Mode): boolean {
		const contentEl = this.view.contentEl;
		let parent: HTMLElement | null;
		let scroller: HTMLElement | null;
		let sizer: HTMLElement | null;

		if (mode === "source") {
			sizer = contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-sizer");
			scroller = contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-scroller");
			const content = sizer?.querySelector<HTMLElement>(":scope > .cm-contentContainer");
			if (!sizer || !scroller || !content) return false;
			if (this.rootEl.previousElementSibling !== content) content.after(this.rootEl);
			parent = sizer;
		} else {
			scroller = contentEl.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-view");
			sizer = scroller?.querySelector<HTMLElement>(":scope > .markdown-preview-sizer") ?? null;
			parent = sizer?.querySelector<HTMLElement>(":scope > .mod-footer") ?? null;
			if (!scroller || !sizer || !parent) return false;
			if (this.rootEl.parentElement !== parent) parent.appendChild(this.rootEl);
		}

		if (mode !== this.mode) {
			this.mode = mode;
			this.resizeObserver.disconnect();
			this.resizeObserver.observe(scroller);
			this.resizeObserver.observe(sizer);
			this.rootEl.toggleClass("is-reading", mode === "preview");
		}
		return true;
	}

	private detach() {
		this.rootEl.remove();
		this.rootEl.hide();
		this.view.contentEl.removeClass("better-backlinks-shown");
		this.resizeObserver.disconnect();
		this.mode = null;
	}

	private clearCards() {
		for (const card of [...this.cards.values(), ...this.unlinkedCards.values()]) this.removeChild(card);
		this.cards.clear();
		this.unlinkedCards.clear();
		this.cardsEl.empty();
		this.unlinkedCardsEl.empty();
	}

	private scheduleMeasure() {
		cancelAnimationFrame(this.measureFrame);
		this.measureFrame = requestAnimationFrame(() => this.measure());
	}

	/**
	 * The panel's rule and tint run the full width of the pane, past the text
	 * column, and down to its bottom edge, while the cards line up with the
	 * text column. Themes size the column differently (the default theme
	 * narrows the sizer, Minimal narrows each line), so measure both.
	 */
	private measure() {
		const scroller = this.rootEl.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
		const sizer = this.rootEl.closest<HTMLElement>(".cm-sizer, .markdown-preview-sizer");
		if (!scroller || !sizer || !this.rootEl.isShown()) return;

		const scrollerRect = scroller.getBoundingClientRect();
		const sizerRect = sizer.getBoundingClientRect();
		// Some themes (Minimal) narrow Reading view's footer too, so bleed out
		// from whatever box the section actually sits in.
		const parent = this.rootEl.parentElement ?? sizer;
		const parentRect = parent.getBoundingClientRect();
		const parentStyle = getComputedStyle(parent);
		const contentLeft = parentRect.left + parent.clientLeft + (parseFloat(parentStyle.paddingLeft) || 0);
		const contentRight = contentLeft + parent.clientWidth - (parseFloat(parentStyle.paddingLeft) || 0) - (parseFloat(parentStyle.paddingRight) || 0);
		const innerLeft = scrollerRect.left + scroller.clientLeft;
		const style = getComputedStyle(scroller);
		const bleed = {
			left: Math.max(0, contentLeft - innerLeft),
			right: Math.max(0, innerLeft + scroller.clientWidth - contentRight),
			bottom: parseFloat(style.paddingBottom) || 0,
		};
		const column = this.textColumn(sizer) ?? sizerRect;
		const inset = {
			left: Math.max(0, column.left - innerLeft),
			right: Math.max(0, innerLeft + scroller.clientWidth - column.right),
		};
		const px = (n: number) => `${n}px`;
		this.rootEl.style.setProperty("--better-backlinks-bleed-left", px(bleed.left));
		this.rootEl.style.setProperty("--better-backlinks-bleed-right", px(bleed.right));
		this.rootEl.style.setProperty("--better-backlinks-bleed-bottom", px(bleed.bottom));
		this.rootEl.style.setProperty("--better-backlinks-inset-left", px(inset.left));
		this.rootEl.style.setProperty("--better-backlinks-inset-right", px(inset.right));

		// In Live Preview the sizer is a full-height flex column, so CSS alone
		// pins the section to the bottom of a short note. Reading view needs the
		// leftover space measured.
		if (this.mode === "preview") {
			const current = parseFloat(this.rootEl.style.getPropertyValue("--better-backlinks-push")) || 0;
			// scrollHeight never drops below clientHeight, so measure the content's own end.
			const contentEnd =
				sizerRect.bottom - scrollerRect.top - scroller.clientTop + scroller.scrollTop + bleed.bottom;
			const spare = scroller.clientHeight - (contentEnd - current);
			const push = Math.max(0, Math.floor(spare));
			if (push !== current) this.rootEl.style.setProperty("--better-backlinks-push", `${push}px`);
		}
	}

	/** The box of a plain line of note text, which sits in the theme's text column. */
	private textColumn(sizer: HTMLElement): DOMRect | null {
		const selectors = [
			".inline-title",
			":scope > .cm-contentContainer .cm-line",
			":scope > div:not(.markdown-preview-pusher, .mod-header, .mod-footer) > :is(p, h1, h2, h3, h4, h5, h6, ul, ol)",
		];
		for (const selector of selectors) {
			for (const el of Array.from(sizer.querySelectorAll<HTMLElement>(selector)).slice(0, 5)) {
				const rect = el.getBoundingClientRect();
				if (rect.width > 0) return rect;
			}
		}
		return null;
	}

	/**
	 * Collapse all / Expand all covers the linked cards: title-match cards have
	 * no body, and unlinked mentions are suggestions the user opens one by one.
	 */
	private expandableCards(): Card[] {
		return [...this.cards.values()].filter((c) => c.expandable);
	}

	private updateToggleAll() {
		const cards = this.expandableCards();
		const expanded = cards.filter((c) => c.expanded).length;
		this.toggleAllEl.toggle(cards.length > 0);
		this.toggleAllEl.setText(expanded * 2 >= cards.length ? "Collapse all" : "Expand all");
	}

	private toggleAll() {
		const cards = this.expandableCards();
		const expand = cards.filter((c) => c.expanded).length * 2 < cards.length;
		if (this.target) {
			this.plugin.setCollapsed(
				this.target.path,
				cards.map((c) => [collapseId(c.source), !expand]),
			);
		}
	}

	private onClick(evt: MouseEvent) {
		const el = evt.target as HTMLElement;
		const card = this.cardFor(el);
		if (!card || !this.target) return;

		const linkButton = el.closest<HTMLElement>(".better-backlinks-link-button");
		if (linkButton) {
			evt.preventDefault();
			void card.linkOne(linkButton);
			return;
		}

		const checkbox = el.closest<HTMLInputElement>("input.task-list-item-checkbox");
		if (checkbox) {
			void card.toggleCheckbox(checkbox);
			return;
		}

		const mentionEl = el.closest<HTMLElement>(".better-backlinks-mention");
		if (mentionEl) {
			evt.preventDefault();
			const propertyKey = card.propertyKeyFor(mentionEl);
			if (propertyKey !== undefined) {
				void openProperty(this.app, card.source.file, propertyKey, evt);
				return;
			}
			const mention = card.mentionFor(mentionEl);
			if (mention) void openMention(this.app, card.source, this.target, mention, evt);
			else void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(this.target);
			return;
		}

		const link = el.closest<HTMLElement>(".better-backlinks-excerpt a.internal-link");
		if (link) {
			evt.preventDefault();
			const href = link.dataset.href ?? link.getAttr("href") ?? "";
			void this.app.workspace.openLinkText(href, card.source.file.path, Keymap.isModEvent(evt));
		}
	}

	private onHover(evt: MouseEvent) {
		const el = evt.target as HTMLElement;
		const card = this.cardFor(el);
		if (!card) return;

		const title = el.closest<HTMLElement>(".better-backlinks-card-title");
		const link = el.closest<HTMLElement>(".better-backlinks-excerpt a.internal-link");
		const targetEl = title ?? link;
		if (!targetEl) return;
		this.app.workspace.trigger("hover-link", {
			event: evt,
			source: HOVER_SOURCE,
			hoverParent: this,
			targetEl,
			linktext: title ? card.source.file.path : (link?.dataset.href ?? ""),
			sourcePath: title ? (this.target?.path ?? "") : card.source.file.path,
		});
	}

	private cardFor(el: HTMLElement): Card | undefined {
		const cardEl = el.closest(".better-backlinks-card");
		for (const card of [...this.cards.values(), ...this.unlinkedCards.values()]) if (card.el === cardEl) return card;
		return undefined;
	}
}

class Card extends Component {
	readonly el: HTMLElement;
	private readonly titleEl: HTMLElement;
	private readonly metaEl: HTMLElement;
	private readonly chevronEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private bodyComponent: Component | null = null;
	private renderedSignature: string | null = null;
	private showAll = false;
	private alive = false;
	private readonly mentionByEl = new WeakMap<HTMLElement, Mention>();
	private readonly propertyKeyByEl = new WeakMap<HTMLElement, string>();
	private readonly linkButtonMention = new WeakMap<HTMLElement, Mention>();
	private linkAllEl: HTMLElement | null = null;
	private readonly taskLineByEl = new WeakMap<HTMLElement, number>();

	constructor(
		private readonly section: BacklinksSection,
		public source: BacklinkSource,
		public expanded: boolean,
	) {
		super();
		this.el = createDiv({ cls: "better-backlinks-card" });
		const headerEl = this.el.createDiv({ cls: "better-backlinks-card-header", attr: { role: "button", tabindex: "0" } });
		headerEl.createSpan({ cls: "better-backlinks-card-hash", text: "#" });
		this.titleEl = headerEl.createEl("a", { cls: "better-backlinks-card-title" });
		this.metaEl = headerEl.createSpan({ cls: "better-backlinks-card-meta" });
		if (source.kind === "unlinked") {
			this.linkAllEl = headerEl.createEl("button", { cls: "better-backlinks-link-all", text: "Link all" });
			this.registerDomEvent(this.linkAllEl, "click", (evt) => {
				evt.stopPropagation();
				void this.linkAll();
			});
		}
		this.chevronEl = headerEl.createDiv({ cls: "better-backlinks-card-chevron" });
		// The wrap animates its grid row between 0fr and 1fr; the clip hides the
		// padded body while it shrinks.
		const bodyWrapEl = this.el.createDiv({ cls: "better-backlinks-card-body-wrap" });
		const bodyClipEl = bodyWrapEl.createDiv({ cls: "better-backlinks-card-body-clip" });
		this.bodyEl = bodyClipEl.createDiv({ cls: "better-backlinks-card-body" });

		this.registerDomEvent(headerEl, "click", (evt) => {
			if (this.titleEl.contains(evt.target as Node) || !this.expandable) return;
			this.toggle();
		});
		this.registerDomEvent(headerEl, "keydown", (evt) => {
			if (!this.expandable || evt.target !== headerEl || (evt.key !== "Enter" && evt.key !== " ")) return;
			evt.preventDefault();
			this.toggle();
		});
		this.registerDomEvent(this.titleEl, "click", (evt) => {
			evt.preventDefault();
			void this.section.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(this.source.file);
		});
	}

	override onload() {
		this.alive = true;
		this.update(this.source);
		this.applyExpanded();
	}

	override onunload() {
		this.alive = false;
		this.el.remove();
	}

	/** A card for a title match has nothing to expand: it's just the header strip. */
	get expandable(): boolean {
		return this.source.titleMatch === null;
	}

	update(source: BacklinkSource) {
		const wasExpandable = this.expandable;
		this.source = source;
		const { file, titleMatch } = source;

		this.titleEl.empty();
		if (titleMatch) {
			const name = file.basename;
			this.titleEl.appendText(name.slice(0, titleMatch.start));
			this.titleEl.createSpan({ cls: "better-backlinks-title-match", text: name.slice(titleMatch.start, titleMatch.end) });
			this.titleEl.appendText(name.slice(titleMatch.end));
		} else {
			this.titleEl.setText(file.basename);
		}
		const what = titleMatch
			? "title match"
			: plural(mentionCount(source), source.kind === "unlinked" ? "unlinked mention" : "mention");
		const age = this.section.showsCreated
			? `created ${formatAge(file.stat.ctime)}`
			: formatAge(file.stat.mtime);
		this.metaEl.setText(`${what} · ${age}`);

		if (wasExpandable !== this.expandable) this.applyExpanded();
		else if (this.expanded && this.expandable && this.renderedSignature !== signature(source)) void this.renderBody();
	}

	setExpanded(expanded: boolean) {
		if (expanded === this.expanded) return;
		this.expanded = expanded;
		this.applyExpanded();
	}

	mentionFor(el: HTMLElement): Mention | undefined {
		return this.mentionByEl.get(el);
	}

	/** Links the one unlinked mention next to this Link button. */
	async linkOne(button: HTMLElement) {
		const mention = this.linkButtonMention.get(button);
		const target = this.section.getTarget();
		if (!mention || !target) return;
		button.addClass("is-disabled");
		await linkMentions(this.section.app, this.source.file, target, [mention]);
	}

	/** Links every unlinked mention in this note. */
	async linkAll() {
		const target = this.section.getTarget();
		if (!target) return;
		this.linkAllEl?.setAttr("disabled", "true");
		// Use the mentions as they are now, not as they were when the card rendered.
		const fresh = await findUnlinked(this.section.app, this.source.file, target);
		if (fresh) await linkMentions(this.section.app, this.source.file, target, fresh.mentions);
		this.linkAllEl?.removeAttribute("disabled");
	}

	/** The property a highlighted property link sits in, if `el` is one. */
	propertyKeyFor(el: HTMLElement): string | undefined {
		return this.propertyKeyByEl.get(el);
	}

	async toggleCheckbox(checkbox: HTMLInputElement) {
		const line = this.taskLineByEl.get(checkbox);
		if (line === undefined) return;
		let written = false;
		await this.section.app.vault.process(this.source.file, (text) => {
			const next = toggleTask(text, line);
			written = next !== null;
			return next ?? text;
		});
		// On success the metadata change re-renders the card; otherwise re-render now.
		if (!written) {
			this.renderedSignature = null;
			void this.renderBody();
		}
	}

	private toggle() {
		this.setExpanded(!this.expanded);
		this.section.onCardToggled(this);
	}

	private applyExpanded() {
		const header = this.el.querySelector<HTMLElement>(".better-backlinks-card-header");
		this.el.toggleClass("is-title-match", !this.expandable);
		if (!this.expandable) {
			this.el.addClass("is-collapsed");
			this.chevronEl.empty();
			this.bodyEl.empty();
			this.renderedSignature = null;
			header?.removeAttribute("role");
			header?.removeAttribute("tabindex");
			header?.removeAttribute("aria-expanded");
			return;
		}
		header?.setAttrs({ role: "button", tabindex: "0", "aria-expanded": String(this.expanded) });
		this.el.toggleClass("is-collapsed", !this.expanded);
		setIcon(this.chevronEl, this.expanded ? "chevron-down" : "chevron-right");
		if (this.expanded && this.renderedSignature !== signature(this.source)) void this.renderBody();
	}

	private async renderBody() {
		const source = this.source;
		const target = this.section.getTarget();
		if (!target) return;
		const sig = signature(source);
		this.renderedSignature = sig;

		const excerpts = await loadExcerpts(this.section.app, source, target);
		if (this.renderedSignature !== sig || !this.alive) return;

		if (this.bodyComponent) this.removeChild(this.bodyComponent);
		const component = this.addChild(new Component());
		this.bodyComponent = component;

		const limit = this.section.plugin.settings.mentionsPerCard;
		const shown = this.showAll ? excerpts : excerpts.slice(0, limit);
		const fragment = createDiv();
		// Property links sit above the body excerpts and don't count toward the limit.
		if (source.propertyMentions.length > 0) this.renderProperties(fragment, target);
		for (const excerpt of shown) {
			const excerptEl = fragment.createDiv({ cls: "better-backlinks-excerpt markdown-rendered" });
			await MarkdownRenderer.render(this.section.app, excerpt.markdown, excerptEl, source.file.path, component);
			this.decorate(excerptEl, excerpt, target);
		}
		const hidden = excerpts.length - shown.length;
		if (hidden > 0) {
			const moreEl = fragment.createDiv({
				cls: "better-backlinks-more",
				text: `+${plural(hidden, "more mention")} in this note`,
				attr: { role: "button", tabindex: "0" },
			});
			moreEl.addEventListener("click", () => {
				this.showAll = true;
				this.renderedSignature = null;
				void this.renderBody();
			});
		}
		if (this.renderedSignature !== sig || !this.alive) return;
		this.bodyEl.replaceChildren(...Array.from(fragment.childNodes));
	}

	private renderProperties(parent: HTMLElement, target: TFile) {
		const app = this.section.app;
		const sourcePath = this.source.file.path;
		const cache = app.metadataCache.getFileCache(this.source.file);
		const rows = propertyRows(cache?.frontmatter, cache?.frontmatterLinks ?? [], (linktext) =>
			resolvesTo(app, linktext, sourcePath, target),
		);
		if (rows.length === 0) return;

		const el = parent.createDiv({ cls: "better-backlinks-excerpt better-backlinks-properties markdown-rendered" });
		for (const row of rows) {
			const rowEl = el.createDiv({ cls: "better-backlinks-property" });
			rowEl.createSpan({ cls: "better-backlinks-property-key", text: row.key });
			const valuesEl = rowEl.createSpan({ cls: "better-backlinks-property-values" });
			for (const value of row.values) {
				if (!value.link) {
					valuesEl.createSpan({ cls: "better-backlinks-property-value", text: value.text });
					continue;
				}
				const a = valuesEl.createEl("a", {
					cls: "internal-link",
					text: value.text,
					attr: { "data-href": value.link.linktext, href: value.link.linktext },
				});
				if (value.link.isMention) {
					a.addClass("better-backlinks-mention");
					this.propertyKeyByEl.set(a, row.key);
				}
			}
		}
	}

	private decorate(el: HTMLElement, excerpt: Excerpt, target: TFile) {
		const app = this.section.app;
		const sourcePath = this.source.file.path;

		if (this.source.kind === "unlinked") {
			// Each plain-text mention gets a Link button after it; clicking the text jumps to it.
			el.querySelectorAll<HTMLElement>(`span.${UNLINKED_CLASS}`).forEach((span) => {
				const mention = excerpt.mentions[Number(span.dataset.mention)];
				if (!mention) return;
				span.addClass("better-backlinks-mention");
				this.mentionByEl.set(span, mention);
				// An inline span rather than a <button>: a button is an atomic box the
				// line can break after, stranding following punctuation on its own line.
				const button = createSpan({
					cls: "better-backlinks-link-button",
					attr: { role: "button", tabindex: "0", "aria-label": `Link "${mention.displayText}" to ${target.basename}` },
				});
				setIcon(button.createSpan({ cls: "better-backlinks-link-icon" }), "link");
				button.createSpan({ text: "Link" });
				this.linkButtonMention.set(button, mention);
				button.addEventListener("keydown", (evt) => {
					if (evt.key !== "Enter" && evt.key !== " ") return;
					evt.preventDefault();
					void this.linkOne(button);
				});
				span.after(button);
			});
			this.markTasks(el, excerpt);
			return;
		}

		const anchors = Array.from(el.querySelectorAll<HTMLElement>("a.internal-link")).filter((a) =>
			resolvesTo(app, a.dataset.href ?? a.getAttr("href") ?? "", sourcePath, target),
		);
		anchors.forEach((a, i) => {
			a.addClass("better-backlinks-mention");
			const mention = excerpt.anchors[i];
			if (mention) this.mentionByEl.set(a, mention);
		});

		if (excerpt.ancestorCount > 0) {
			const items = el.querySelectorAll<HTMLElement>("li");
			for (let i = 0; i < excerpt.ancestorCount; i++) items[i]?.addClass("better-backlinks-context");
			items[excerpt.ancestorCount]?.addClass("better-backlinks-match");
		}

		this.markTasks(el, excerpt);
	}

	private markTasks(el: HTMLElement, excerpt: Excerpt) {
		el.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((checkbox, i) => {
			const line = excerpt.taskLines[i];
			if (line !== undefined) this.taskLineByEl.set(checkbox, line);
			else checkbox.disabled = true;
		});
	}
}

/** A card's key in the saved collapse state; unlinked cards are kept apart from linked ones. */
function collapseId(source: BacklinkSource): string {
	return source.kind === "unlinked" ? `${source.file.path}\nunlinked` : source.file.path;
}

/** Changes whenever the card's excerpts could render differently. */
function signature(source: BacklinkSource): string {
	return [
		source.file.path,
		source.file.stat.mtime,
		...source.mentions.map((m) => m.position.start.offset),
		...source.propertyMentions.map((m) => m.key),
		source.titleMatch ? "title" : "",
	].join("|");
}

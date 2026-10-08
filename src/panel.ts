// The backlinks content: the Backlinks, Created on this day / this week and
// Unlinked mentions groups and their cards, for one note. Hosted at the bottom of a
// note (view.ts) or in the sidebar (sidebar.ts).

import {
	Component,
	Keymap,
	MarkdownRenderer,
	Menu,
	setIcon,
	type HoverParent,
	type HoverPopover,
	type TFile,
} from "obsidian";
import {
	findBacklinkSources,
	findCreatedIn,
	findUnlinked,
	isExcluded,
	loadExcerpts,
	mentionCount,
	type CardExcerpt,
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
import { combineSources } from "./combine";
import { compareBy, SORT_ORDERS, sortLabel } from "./sort";

export const HOVER_SOURCE = "better-backlinks";

/** What a panel needs from whatever displays it. */
export interface PanelHost {
	/** False while the host isn't showing the panel; the panel then skips work. */
	isLive(): boolean;
	/** Called after each render, with whether there's anything to show. */
	onRender(shown: boolean): void;
}

export class BacklinksPanel extends Component implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	/** The panel's element, which the host places wherever it shows the panel. */
	readonly el: HTMLElement;

	private readonly countEl: HTMLElement;
	private readonly toggleAllEl: HTMLElement;
	private readonly sortEl: HTMLElement;
	private readonly cardsEl: HTMLElement;
	private readonly cards = new Map<string, Card>();
	private readonly createdGroupEl: HTMLElement;
	private readonly createdTitleEl: HTMLElement;
	private readonly createdCountEl: HTMLElement;
	/** Whether the created group is for a daily note's day or a weekly note's week. */
	createdUnit: "day" | "week" = "day";
	private readonly createdCardsEl: HTMLElement;
	private readonly createdCards = new Map<string, Card>();
	/** Notes created on the day of the current daily note; empty for other notes. */
	private createdSources: BacklinkSource[] = [];
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
	private target: TFile | null = null;

	constructor(
		readonly plugin: BetterBacklinksPlugin,
		private readonly host: PanelHost,
	) {
		super();
		const panelEl = (this.el = createDiv({ cls: "better-backlinks-panel" }));
		const headerEl = panelEl.createDiv({ cls: "better-backlinks-header" });
		headerEl.createDiv({ cls: "better-backlinks-title", text: "Backlinks" });
		this.countEl = headerEl.createDiv({ cls: "better-backlinks-count" });
		this.sortEl = headerEl.createDiv({ cls: "better-backlinks-sort clickable-icon", attr: { role: "button", tabindex: "0" } });
		setIcon(this.sortEl, "arrow-up-narrow-wide");
		this.toggleAllEl = headerEl.createEl("button", { cls: "better-backlinks-toggle-all" });
		this.cardsEl = panelEl.createDiv({ cls: "better-backlinks-cards" });
		this.createdGroupEl = panelEl.createDiv({ cls: "better-backlinks-group" });
		this.createdGroupEl.hide();
		const createdHeaderEl = this.createdGroupEl.createDiv({ cls: "better-backlinks-header" });
		this.createdTitleEl = createdHeaderEl.createDiv({ cls: "better-backlinks-title", text: "Created on this day" });
		this.createdCountEl = createdHeaderEl.createDiv({ cls: "better-backlinks-count" });
		this.createdCardsEl = this.createdGroupEl.createDiv({ cls: "better-backlinks-cards" });
		this.unlinkedGroupEl = panelEl.createDiv({ cls: "better-backlinks-group" });
		this.unlinkedGroupEl.hide();
		const groupHeaderEl = this.unlinkedGroupEl.createDiv({ cls: "better-backlinks-header" });
		groupHeaderEl.createDiv({ cls: "better-backlinks-title", text: "Unlinked mentions" });
		this.unlinkedCountEl = groupHeaderEl.createDiv({ cls: "better-backlinks-count" });
		this.unlinkedCardsEl = this.unlinkedGroupEl.createDiv({ cls: "better-backlinks-cards" });
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
		this.registerDomEvent(this.el, "click", (evt) => this.onClick(evt));
		this.registerDomEvent(this.el, "mouseover", (evt) => this.onHover(evt));
	}

	override onunload() {
		this.scanToken++;
		this.clearCards();
		this.el.remove();
	}

	/** Points the panel at a note (or none); a different note starts afresh. */
	setTarget(file: TFile | null) {
		if (file === this.target) return;
		this.clearCards();
		this.target = file;
		this.linkedSources = [];
		this.createdSources = [];
	}

	/** Recomputes the backlinks; only cards whose source changed are re-rendered. */
	refresh() {
		const target = this.target;
		if (!target || !this.host.isLive()) return;
		this.el.toggleClass("is-plain", !this.plugin.settings.highlightMatches);

		const { excludedFolders, includePropertyLinks, includeTitleMatches } = this.plugin.settings;
		const sources = findBacklinkSources(this.app, target, {
			excludedFolders,
			includePropertyLinks,
			includeTitleMatches,
		});
		this.linkedSources = sources;
		const period = this.plugin.periodFor(target);
		this.createdUnit = period?.unit ?? "day";
		this.createdTitleEl.setText(this.createdUnit === "week" ? "Created this week" : "Created on this day");
		this.createdSources = period
			? findCreatedIn(this.app, target, period.range, this.plugin.settings.createdProperty.trim(), excludedFolders)
			: [];
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

	/** Shows the backlink cards, then the notes created that day, then the unlinked mentions. */
	private render() {
		const target = this.target;
		if (!target || !this.host.isLive()) return;
		const compare = compareBy(this.plugin.getSort(target.path));
		const linked = [...this.linkedSources].sort(compare);
		const unlinked = [...this.unlinkedSources.values()].sort(compare);
		const created = [...this.createdSources].sort(compare);
		this.sortEl.setAttr("aria-label", `Sort: ${sortLabel(this.plugin.getSort(target.path))}`);

		const shown = linked.length > 0 || unlinked.length > 0 || created.length > 0;
		if (!shown) {
			this.clearCards();
			this.host.onRender(false);
			return;
		}
		const { expandUpTo } = this.plugin.settings;

		if (this.combined) {
			// One list, one card per note, in the note's sort order.
			const all = combineSources(linked, created, unlinked).sort(compare);
			this.countEl.show();
			this.countEl.setText(plural(all.length, "note"));
			// Unlinked mentions are suggestions, so a card that's only that starts collapsed.
			const unlinkedOnly = (s: BacklinkSource) => s.kind === "unlinked" && !s.created;
			this.syncCards(this.cards, this.cardsEl, all, (s) => !unlinkedOnly(s) && all.length <= expandUpTo);
			this.createdGroupEl.hide();
			this.syncCards(this.createdCards, this.createdCardsEl, [], () => false);
			this.unlinkedGroupEl.hide();
			this.syncCards(this.unlinkedCards, this.unlinkedCardsEl, [], () => false);
			this.updateToggleAll();
			this.host.onRender(true);
			return;
		}

		this.countEl.toggle(linked.length > 0);
		this.countEl.setText(plural(linked.length, "note"));
		this.syncCards(this.cards, this.cardsEl, linked, () => linked.length <= expandUpTo);

		this.createdGroupEl.toggle(created.length > 0);
		this.createdCountEl.setText(plural(created.length, "note"));
		this.syncCards(this.createdCards, this.createdCardsEl, created, () => created.length <= expandUpTo);

		this.unlinkedGroupEl.toggle(unlinked.length > 0);
		this.unlinkedCountEl.setText(plural(unlinked.length, "note"));
		// Unlinked mentions are suggestions, so their cards start collapsed.
		this.syncCards(this.unlinkedCards, this.unlinkedCardsEl, unlinked, () => false);

		this.updateToggleAll();
		this.host.onRender(true);
	}

	/** Whether backlinks, created-in-period notes and unlinked mentions show as one list. */
	get combined(): boolean {
		return this.plugin.settings.combineGroups;
	}

	/**
	 * A card's key in the saved collapse state. In the combined list each note
	 * has one card and so one key; in groups, unlinked and created cards are
	 * kept apart from a note's backlink card.
	 */
	collapseIdFor(source: BacklinkSource): string {
		return this.combined ? source.file.path : collapseId(source);
	}

	/** Brings one group's cards in line with `sources`: adds, updates, reorders and removes. */
	private syncCards(
		cards: Map<string, Card>,
		containerEl: HTMLElement,
		sources: BacklinkSource[],
		expandByDefault: (source: BacklinkSource) => boolean,
	) {
		const target = this.target;
		if (!target) return;
		const seen = new Set<string>();
		sources.forEach((source, index) => {
			const path = source.file.path;
			seen.add(path);
			let card = cards.get(path);
			if (!card) {
				const collapsed = this.plugin.getCollapsed(target.path, this.collapseIdFor(source));
				card = this.addChild(new Card(this, source, collapsed === undefined ? expandByDefault(source) : !collapsed));
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
		for (const card of this.allCards()) {
			const collapsed = this.plugin.getCollapsed(this.target.path, this.collapseIdFor(card.source));
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

	/** Rebuilds every card, e.g. after a settings change. */
	rerender() {
		this.clearCards();
		this.refresh();
	}

	getTarget(): TFile | null {
		return this.target;
	}

	onCardToggled(card: Card) {
		if (this.target) this.plugin.setCollapsed(this.target.path, [[this.collapseIdFor(card.source), !card.expanded]]);
	}

	private allCards(): Card[] {
		return [...this.cards.values(), ...this.createdCards.values(), ...this.unlinkedCards.values()];
	}

	private clearCards() {
		for (const card of this.allCards()) this.removeChild(card);
		this.cards.clear();
		this.createdCards.clear();
		this.unlinkedCards.clear();
		this.cardsEl.empty();
		this.createdCardsEl.empty();
		this.unlinkedCardsEl.empty();
	}

	/**
	 * Collapse all / Expand all covers every card in the note that can expand:
	 * backlinks, notes created that day or week, and unlinked mentions.
	 * Title-match cards have no body, so they're left out.
	 */
	private expandableCards(): Card[] {
		return this.allCards().filter((c) => c.expandable);
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
				cards.map((c) => [this.collapseIdFor(c.source), !expand]),
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
		for (const card of this.allCards()) if (card.el === cardEl) return card;
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
	private readonly linkAllEl: HTMLElement;
	private readonly taskLineByEl = new WeakMap<HTMLElement, number>();

	constructor(
		private readonly panel: BacklinksPanel,
		public source: BacklinkSource,
		public expanded: boolean,
	) {
		super();
		this.el = createDiv({ cls: "better-backlinks-card" });
		const headerEl = this.el.createDiv({ cls: "better-backlinks-card-header", attr: { role: "button", tabindex: "0" } });
		headerEl.createSpan({ cls: "better-backlinks-card-hash", text: "#" });
		this.titleEl = headerEl.createEl("a", { cls: "better-backlinks-card-title" });
		this.metaEl = headerEl.createSpan({ cls: "better-backlinks-card-meta" });
		// Shown when the note has plain-text mentions; a combined card can gain or lose them.
		this.linkAllEl = headerEl.createEl("button", { cls: "better-backlinks-link-all", text: "Link all" });
		this.linkAllEl.hide();
		this.registerDomEvent(this.linkAllEl, "click", (evt) => {
			evt.stopPropagation();
			void this.linkAll();
		});
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
			void this.panel.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(this.source.file);
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

	/**
	 * A card that's only a title match has nothing to expand: it's just the
	 * header strip. In the combined list the same note may also have unlinked
	 * mentions or have been created in the period, which give it a body.
	 */
	get expandable(): boolean {
		const { titleMatch, unlinked, created } = this.source;
		return !(titleMatch && mentionCount(this.source) === 0 && !unlinked?.length && !created);
	}

	private get hasUnlinked(): boolean {
		return this.source.kind === "unlinked" || (this.source.unlinked?.length ?? 0) > 0;
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
		const age = this.panel.showsCreated
			? `created ${formatAge(file.stat.ctime)}`
			: formatAge(file.stat.mtime);
		// The words in the "label" spans are hidden on mobile to leave the title
		// more room: "1 mention · 3h ago" becomes "1 · 3h ago", and a title match
		// shows just its age.
		this.metaEl.empty();
		const label = "better-backlinks-card-meta-label";
		// Within a day, the time; within a week, the weekday too ("Mon 9:42 AM").
		const createdText = source.created ? this.createdText(source.created) : "";
		const count = (n: number, noun: string) => {
			this.metaEl.appendText(String(n));
			this.metaEl.createSpan({ cls: label, text: ` ${plural(n, noun).replace(/^\d+ /, "")}` });
			this.metaEl.appendText(" · ");
		};
		if (source.kind === "created" && !this.panel.combined) {
			// The group says when; the card says what time, if known.
			this.metaEl.setText(createdText);
		} else {
			if (source.kind === "created") {
				// Only here for being created in the period.
			} else if (titleMatch && mentionCount(source) === 0) {
				this.metaEl.createSpan({ cls: label, text: "title match · " });
			} else {
				count(mentionCount(source), source.kind === "unlinked" ? "unlinked mention" : "mention");
			}
			if (source.unlinked?.length) count(source.unlinked.length, "unlinked");
			if (source.created && createdText) {
				this.metaEl.createSpan({ cls: label, text: "created " });
				this.metaEl.appendText(`${createdText} · `);
			}
			this.metaEl.appendText(age);
		}
		this.linkAllEl.toggle(this.hasUnlinked);

		if (wasExpandable !== this.expandable) this.applyExpanded();
		else if (this.expanded && this.expandable && this.renderedSignature !== signature(source)) void this.renderBody();
	}

	/** "9:42 AM" for a day, "Mon 9:42 AM" for a week; no time when the date had none. */
	private createdText(created: { time: number; hasTime: boolean }): string {
		const date = new Date(created.time);
		const parts: string[] = [];
		if (this.panel.createdUnit === "week") parts.push(date.toLocaleDateString([], { weekday: "short" }));
		if (created.hasTime) parts.push(date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
		return parts.join(" ");
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
		const target = this.panel.getTarget();
		if (!mention || !target) return;
		button.addClass("is-disabled");
		await linkMentions(this.panel.app, this.source.file, target, [mention]);
	}

	/** Links every unlinked mention in this note. */
	async linkAll() {
		const target = this.panel.getTarget();
		if (!target) return;
		this.linkAllEl.setAttr("disabled", "true");
		// Use the mentions as they are now, not as they were when the card rendered.
		const fresh = await findUnlinked(this.panel.app, this.source.file, target);
		if (fresh) await linkMentions(this.panel.app, this.source.file, target, fresh.mentions);
		this.linkAllEl.removeAttribute("disabled");
	}

	/** The property a highlighted property link sits in, if `el` is one. */
	propertyKeyFor(el: HTMLElement): string | undefined {
		return this.propertyKeyByEl.get(el);
	}

	async toggleCheckbox(checkbox: HTMLInputElement) {
		const line = this.taskLineByEl.get(checkbox);
		if (line === undefined) return;
		let written = false;
		await this.panel.app.vault.process(this.source.file, (text) => {
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
		this.panel.onCardToggled(this);
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
		const target = this.panel.getTarget();
		if (!target) return;
		const sig = signature(source);
		this.renderedSignature = sig;

		const excerpts = await loadExcerpts(this.panel.app, source, target);
		if (this.renderedSignature !== sig || !this.alive) return;

		if (this.bodyComponent) this.removeChild(this.bodyComponent);
		const component = this.addChild(new Component());
		this.bodyComponent = component;

		const limit = this.panel.plugin.settings.mentionsPerCard;
		const shown = this.showAll ? excerpts : excerpts.slice(0, limit);
		const fragment = createDiv();
		// Property links sit above the body excerpts and don't count toward the limit.
		if (source.propertyMentions.length > 0) this.renderProperties(fragment, target);
		for (const { excerpt, kind } of shown) {
			const excerptEl = fragment.createDiv({ cls: "better-backlinks-excerpt markdown-rendered" });
			await MarkdownRenderer.render(this.panel.app, excerpt.markdown, excerptEl, source.file.path, component);
			this.decorate(excerptEl, excerpt, kind, target);
		}
		if (source.created && excerpts.length === 0 && source.propertyMentions.length === 0) {
			fragment.createDiv({ cls: "better-backlinks-empty", text: "Empty note" });
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
		const app = this.panel.app;
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

	private decorate(el: HTMLElement, excerpt: Excerpt, kind: CardExcerpt["kind"], target: TFile) {
		const app = this.panel.app;
		const sourcePath = this.source.file.path;

		if (kind === "created") {
			this.markTasks(el, excerpt);
			return;
		}

		if (kind === "unlinked") {
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
	return source.kind === "linked" ? source.file.path : `${source.file.path}\n${source.kind}`;
}

/** Changes whenever the card's excerpts could render differently. */
function signature(source: BacklinkSource): string {
	return [
		source.kind,
		source.file.path,
		source.file.stat.mtime,
		...source.mentions.map((m) => m.position.start.offset),
		...source.propertyMentions.map((m) => m.key),
		source.titleMatch ? "title" : "",
		...(source.unlinked ?? []).map((m) => `u${m.position.start.offset}`),
		source.created ? `c${source.created.time}` : "",
	].join("|");
}

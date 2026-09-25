// The note-bottom host: mounts a BacklinksPanel after a MarkdownView's
// content, inside its scroller but outside the editable document, and keeps
// it sized and placed as the note and pane change.

import { Component, type MarkdownView } from "obsidian";
import type BetterBacklinksPlugin from "./main";
import { BacklinksPanel } from "./panel";

type Mode = "source" | "preview";

export class BacklinksSection extends Component {
	readonly panel: BacklinksPanel;
	private readonly rootEl: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private readonly modeObserver: MutationObserver;
	private mode: Mode | null = null;
	/** Where the section is mounted: the view's scroller, its sizer, and the element carrying Obsidian's scroll-past-end padding. */
	private layout: { scroller: HTMLElement; sizer: HTMLElement; padded: HTMLElement } | null = null;
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
		this.panel = new BacklinksPanel(plugin, {
			isLive: () => this.rootEl.isConnected,
			onRender: (shown) => {
				this.rootEl.toggle(shown);
				if (shown) this.measure();
			},
		});
		this.rootEl.appendChild(this.panel.el);
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
		this.addChild(this.panel);
		for (const child of Array.from(this.view.contentEl.children)) {
			this.modeObserver.observe(child, { attributes: true, attributeFilter: ["style"] });
		}
	}

	override onunload() {
		window.cancelAnimationFrame(this.mountRetryFrame);
		window.cancelAnimationFrame(this.measureFrame);
		this.modeObserver.disconnect();
		this.resizeObserver.disconnect();
		this.rootEl.remove();
	}

	/** Mounts the section in the right place for the view's mode and file, then refreshes it. */
	sync() {
		const { settings } = this.plugin;
		const file = this.view.file;
		const mode = this.view.getMode();
		const enabled =
			settings.showSection && file?.extension === "md" && (mode === "source" || settings.showInReadingView);

		if (!enabled || !file) {
			this.detach();
			return;
		}
		window.cancelAnimationFrame(this.mountRetryFrame);
		if (!this.mount(mode)) {
			// Reading view builds its footer after rendering; try again next frame.
			this.detach();
			if (this.mountRetry++ < 120) this.mountRetryFrame = window.requestAnimationFrame(() => this.sync());
			return;
		}
		this.mountRetry = 0;
		this.panel.setTarget(file);
		this.panel.refresh();
	}

	/** Re-mounts and rebuilds every card, e.g. after a settings change. */
	rerender() {
		this.panel.rerender();
		this.sync();
	}

	/**
	 * Mounts the section right after the element that carries Obsidian's
	 * scroll-past-end padding: the editor's content in Live Preview, the page
	 * sizer in Reading view. measure() then offsets it over that padding.
	 */
	private mount(mode: Mode): boolean {
		const contentEl = this.view.contentEl;
		let scroller: HTMLElement | null;
		let sizer: HTMLElement | null;
		let before: HTMLElement | null;
		let padded: HTMLElement | null;

		if (mode === "source") {
			scroller = contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-scroller");
			sizer = scroller?.querySelector<HTMLElement>(".cm-sizer") ?? null;
			before = sizer?.querySelector<HTMLElement>(":scope > .cm-contentContainer") ?? null;
			padded = before?.querySelector<HTMLElement>(".cm-content") ?? null;
		} else {
			scroller = contentEl.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-view");
			sizer = scroller?.querySelector<HTMLElement>(":scope > .markdown-preview-sizer") ?? null;
			before = sizer;
			padded = sizer;
		}
		if (!scroller || !sizer || !before || !padded) return false;
		if (this.rootEl.previousElementSibling !== before) before.after(this.rootEl);

		if (mode !== this.mode || this.layout?.padded !== padded) {
			this.mode = mode;
			this.layout = { scroller, sizer, padded };
			this.resizeObserver.disconnect();
			// The note's own height changes as it's edited; the section's as cards expand.
			for (const el of [scroller, sizer, before, this.rootEl]) this.resizeObserver.observe(el);
		}
		return true;
	}

	private detach() {
		this.rootEl.remove();
		this.rootEl.hide();
		this.resizeObserver.disconnect();
		this.mode = null;
		this.layout = null;
	}

	private scheduleMeasure() {
		window.cancelAnimationFrame(this.measureFrame);
		this.measureFrame = window.requestAnimationFrame(() => this.measure());
	}

	/**
	 * The panel's rule and tint run the full width of the pane, past the text
	 * column, and down to its bottom edge, while the cards line up with the
	 * text column. Themes size the column differently (the default theme
	 * narrows the sizer, Minimal narrows each line), so measure both.
	 */
	private measure() {
		if (!this.layout || !this.rootEl.isConnected || !this.rootEl.isShown()) return;
		const { scroller, sizer, padded } = this.layout;

		const scrollerRect = scroller.getBoundingClientRect();
		const sizerRect = sizer.getBoundingClientRect();
		// Bleed out from whatever box the section actually sits in.
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
		this.rootEl.setCssProps({
			"--better-backlinks-bleed-left": px(bleed.left),
			"--better-backlinks-bleed-right": px(bleed.right),
			"--better-backlinks-bleed-bottom": px(bleed.bottom),
			"--better-backlinks-inset-left": px(inset.left),
			"--better-backlinks-inset-right": px(inset.right),
		});

		// Obsidian pads the end of the note so its last line can scroll up the
		// pane. That empty space would sit between the note and the section, so
		// shift the section up over it; on a short note, shift it down instead
		// so it sits at the bottom of the pane like a footer.
		const cssNumber = (name: string) => parseFloat(this.rootEl.style.getPropertyValue(name)) || 0;
		const currentOffset = cssNumber("--better-backlinks-offset");
		const currentExtend = cssNumber("--better-backlinks-extend");
		const toScrollSpace = (y: number) => y - scrollerRect.top - scroller.clientTop + scroller.scrollTop;
		const rootRect = this.rootEl.getBoundingClientRect();
		const height = rootRect.height - currentExtend;
		const natural = toScrollSpace(rootRect.top) - currentOffset;
		const noteEnd = natural - (parseFloat(getComputedStyle(padded).paddingBottom) || 0);
		const footerTop = scroller.clientHeight - height;
		const offset = Math.round(Math.max(noteEnd, footerTop) - natural);

		// The padded element still reaches down through its padding, and the
		// browser lets the pane scroll to its end. Grow the panel to cover that
		// space so scrolling past the end shows panel, not a gap below it.
		const paddedEnd = toScrollSpace(this.rootEl.previousElementSibling?.getBoundingClientRect().bottom ?? 0);
		const extend = Math.max(0, Math.round(paddedEnd + bleed.bottom - (natural + offset + height)));

		if (offset !== currentOffset || extend !== currentExtend) {
			this.rootEl.setCssProps({
				"--better-backlinks-offset": `${offset}px`,
				"--better-backlinks-extend": `${extend}px`,
			});
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
}

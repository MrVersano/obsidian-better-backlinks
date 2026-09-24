// Opening a source note at a mention and pulsing it so the user lands oriented.

import {
	Keymap,
	MarkdownView,
	type App,
	type MarkdownPostProcessorContext,
	type MarkdownSectionInformation,
	type TFile,
} from "obsidian";
import { resolvesTo, type BacklinkSource } from "./backlink-index";
import type { Mention } from "./excerpt";
import { editorViewFor, pulseRange } from "./pulse";

const PULSE_MS = 600;

// Reading view renders a long note in sections, only some of which are in the
// DOM at a time, so an element's position says nothing about its source line.
// A post-processor sees every section as it renders; remember its context so
// the section's source lines can be looked up later.
const sectionContexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();

export function rememberSection(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
	sectionContexts.set(el, ctx);
}

function sectionInfo(el: HTMLElement): MarkdownSectionInformation | null {
	return sectionContexts.get(el)?.getSectionInfo(el) ?? null;
}

export async function openMention(app: App, source: BacklinkSource, target: TFile, mention: Mention, evt: MouseEvent) {
	const line = mention.position.start.line;
	const leaf = app.workspace.getLeaf(Keymap.isModEvent(evt));
	await leaf.openFile(source.file, { active: true, eState: { line } });

	const view = leaf.view;
	if (!(view instanceof MarkdownView) || view.file?.path !== source.file.path) return;

	if (view.getMode() === "source") {
		const from = { line, ch: mention.position.start.col };
		const to = { line: mention.position.end.line, ch: mention.position.end.col };
		const editor = view.editor;
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
		editor.focus();
		const cm = editorViewFor(view);
		if (cm) pulseRange(cm, editor.posToOffset(from), editor.posToOffset(to));
		return;
	}

	// Reading view has no editor selection: pulse the rendered block holding the link.
	const el = await findRenderedMention(app, view, source, target, mention);
	if (!el) return;
	el.scrollIntoView({ block: "center" });
	el.addClass("better-backlinks-pulse-block");
	window.setTimeout(() => el.removeClass("better-backlinks-pulse-block"), PULSE_MS);
}

/** Waits for Reading view to render the mention's section, then finds the block around the link. */
async function findRenderedMention(
	app: App,
	view: MarkdownView,
	source: BacklinkSource,
	target: TFile,
	mention: Mention,
): Promise<HTMLElement | null> {
	const line = mention.position.start.line;
	for (let frame = 0; frame < 30; frame++) {
		await nextFrame();
		const sections = view.previewMode.containerEl.querySelectorAll<HTMLElement>(".markdown-preview-sizer > div");
		for (const sectionEl of Array.from(sections)) {
			const info = sectionInfo(sectionEl);
			if (!info || line < info.lineStart || line > info.lineEnd) continue;

			// The nth link to the current note in this section is the nth mention in its lines.
			const index = source.mentions.filter(
				(m) =>
					m.position.start.line >= info.lineStart &&
					m.position.start.offset < mention.position.start.offset,
			).length;
			const anchors = Array.from(sectionEl.querySelectorAll<HTMLElement>("a.internal-link")).filter((a) =>
				resolvesTo(app, a.dataset.href ?? "", source.file.path, target),
			);
			const anchor = anchors[index];
			return anchor?.closest<HTMLElement>("li, p, td, th, h1, h2, h3, h4, h5, h6") ?? sectionEl;
		}
	}
	return null;
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

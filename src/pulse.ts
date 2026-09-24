// A one-off highlight that fades out over a range in the editor, used when
// jumping to a mention so the user lands oriented.

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo } from "obsidian";

const PULSE_MS = 600;

const addPulse = StateEffect.define<{ from: number; to: number }>();
const clearPulse = StateEffect.define<null>();
const pulseMark = Decoration.mark({ class: "better-backlinks-pulse" });

const pulseField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		decorations = decorations.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(addPulse)) decorations = Decoration.set([pulseMark.range(effect.value.from, effect.value.to)]);
			if (effect.is(clearPulse)) decorations = Decoration.none;
		}
		return decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});

// Tracks live editors so a MarkdownView can be matched to its EditorView
// through the public editorInfoField, without reaching into editor internals.
const editors = new Set<EditorView>();
const tracker = ViewPlugin.define((view) => {
	editors.add(view);
	return { destroy: () => editors.delete(view) };
});

export const pulseExtension: Extension = [pulseField, tracker];

export function editorViewFor(info: MarkdownFileInfo): EditorView | undefined {
	for (const view of editors) {
		if (view.state.field(editorInfoField, false) === info) return view;
	}
	return undefined;
}

export function pulseRange(view: EditorView, from: number, to: number): void {
	view.dispatch({ effects: addPulse.of({ from, to }) });
	window.setTimeout(() => {
		if (editors.has(view)) view.dispatch({ effects: clearPulse.of(null) });
	}, PULSE_MS);
}

import { type App, Modal, Setting } from "obsidian";
import { CORE_BACKLINKS } from "./core-backlinks";

/** The settings window, which Obsidian doesn't expose in its typings. */
interface SettingsWindow {
	open(): void;
	openTabById(id: string): unknown;
}

/** Explains that the core plugin's backlinks section duplicates this one, with a way to its settings. */
export class CoreBacklinksModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	override onOpen() {
		this.setTitle("Backlinks shown twice");
		this.contentEl.createEl("p", {
			text: "The core backlinks plugin is set to show backlinks at the bottom of notes, so every note will list its backlinks twice. It's best to turn that option off.",
		});
		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText("Open backlinks settings")
					.setCta()
					.onClick(() => {
						this.close();
						const setting = (this.app as unknown as { setting: SettingsWindow }).setting;
						setting.open();
						setting.openTabById(CORE_BACKLINKS);
					}),
			)
			.addButton((button) => button.setButtonText("Not now").onClick(() => this.close()));
	}

	override onClose() {
		this.contentEl.empty();
	}
}

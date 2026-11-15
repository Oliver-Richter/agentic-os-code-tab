import { App, Modal, Notice, Setting } from "obsidian";
import { getSettings, saveSettings, SETTINGS_FILE, type ThemeMode } from "./settings";

function obsidianApp(): App {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (window as any).app as App;
}

/** Yes/no dialog as Obsidian modal (no window.confirm). Resolves true only on the confirm button. */
export function ask(title: string, message: string, confirmLabel: string): Promise<boolean> {
	return new Promise((resolve) => {
		const m = new Modal(obsidianApp());
		let done = false;
		m.titleEl.setText(title);
		m.contentEl.createEl("p", { text: message });
		const row = m.contentEl.createDiv({ cls: "modal-button-container" });
		row.createEl("button", { text: confirmLabel, cls: "mod-cta" }).addEventListener("click", () => {
			done = true;
			resolve(true);
			m.close();
		});
		row.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => m.close());
		m.onClose = () => { if (!done) resolve(false); };
		m.open();
	});
}

/** Text input dialog (no window.prompt). Resolves null on cancel or empty input. */
export function askText(title: string, label: string, initial: string): Promise<string | null> {
	return new Promise((resolve) => {
		const m = new Modal(obsidianApp());
		let value = initial;
		let done = false;
		m.titleEl.setText(title);
		const submit = (): void => {
			const v = value.trim();
			if (v.length === 0) return;
			done = true;
			resolve(v);
			m.close();
		};
		new Setting(m.contentEl).setName(label).addText((t) => {
			t.setValue(initial).onChange((v) => { value = v; });
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); submit(); }
			});
			window.setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 10);
		});
		const row = m.contentEl.createDiv({ cls: "modal-button-container" });
		row.createEl("button", { text: "OK", cls: "mod-cta" }).addEventListener("click", submit);
		row.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => m.close());
		m.onClose = () => { if (!done) resolve(null); };
		m.open();
	});
}

/** Settings of the Code tab. Separate modal, so the Agentic OS settings tab stays untouched. */
export class CodeSettingsModal extends Modal {
	onOpen(): void {
		const s = getSettings();
		this.titleEl.setText("Code-Tab: Einstellungen");
		let dir = s.startDir;
		new Setting(this.contentEl)
			.setName("Start-Ordner")
			.setDesc("Arbeitsordner für neue Tabs „claude (neutral)“ und Startpunkt des Ordner-Browsers.")
			.addText((t) => t.setValue(dir).onChange((v) => { dir = v; }))
			.addButton((b) => b.setButtonText("Speichern").setCta().onClick(() => {
				try {
					saveSettings({ startDir: dir.trim() });
					new Notice("Start-Ordner gespeichert.");
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e), 6000);
				}
			}));
		new Setting(this.contentEl)
			.setName("Farbschema")
			.setDesc("Automatisch folgt dem Obsidian-Theme.")
			.addDropdown((d) => d
				.addOption("auto", "Automatisch (wie Obsidian)")
				.addOption("dark", "Immer dunkel")
				.addOption("light", "Immer hell")
				.setValue(s.themeMode)
				.onChange((v) => {
					try {
						saveSettings({ themeMode: v as ThemeMode });
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e), 6000);
					}
				}));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: `Gespeichert in ${SETTINGS_FILE}. Schriftgröße und Terminal-Farben (dunkel) kommen aus den Agentic-OS-Einstellungen.` });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

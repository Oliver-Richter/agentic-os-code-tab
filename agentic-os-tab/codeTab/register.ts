import type { Plugin } from "obsidian";
import { CODE_TAB_CSS } from "./codeTabCss";
import { CodeView, VIEW_TYPE_CODE } from "./CodeView";
import { startTheme } from "./theme";
import { CodeSettingsModal } from "./ui";

/** Marker the installer looks for in the built main.js. */
export const ADDON_ID = "agentic-os-code-tab";

async function openCodeView(plugin: Plugin): Promise<void> {
	const ws = plugin.app.workspace;
	const existing = ws.getLeavesOfType(VIEW_TYPE_CODE)[0];
	if (existing !== undefined) {
		ws.revealLeaf(existing);
		return;
	}
	const leaf = ws.getLeaf("tab");
	await leaf.setViewState({ type: VIEW_TYPE_CODE, active: true });
	ws.revealLeaf(leaf);
}

/**
 * Entry point of the Code tab add-on. The installer adds one call to the
 * onload() of the Agentic OS plugin: registerCodeTab(this);
 */
export function registerCodeTab(plugin: Plugin): void {
	const style = document.head.createEl("style", { attr: { id: ADDON_ID + "-css" } });
	style.textContent = CODE_TAB_CSS;
	plugin.register(() => style.remove());

	plugin.register(startTheme());

	plugin.registerView(VIEW_TYPE_CODE, (leaf) => new CodeView(leaf));
	plugin.addRibbonIcon("code", "Open Code", () => { void openCodeView(plugin); });
	plugin.addCommand({ id: "open-code", name: "Open Code", callback: () => { void openCodeView(plugin); } });
	plugin.addCommand({ id: "code-settings", name: "Code-Tab: Einstellungen", callback: () => new CodeSettingsModal(plugin.app).open() });
	console.log(`[${ADDON_ID}] loaded`);
}

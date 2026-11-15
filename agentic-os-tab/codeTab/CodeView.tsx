import { ItemView, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeTabs } from "./CodeTabs";
import { addThemeButton } from "./theme";
import { CodeSettingsModal } from "./ui";

export const VIEW_TYPE_CODE = "agentic-os-code";

/** Obsidian view "Code": Claude Code terminals in tabs, full height. */
export class CodeView extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CODE;
	}

	getDisplayText(): string {
		return "Code";
	}

	getIcon(): string {
		return "code";
	}

	async onOpen(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		el.addClass("agentic-os-root");
		el.addClass("agentic-os-code-leaf");
		this.addAction("settings", "Code-Tab: Einstellungen", () => new CodeSettingsModal(this.app).open());
		addThemeButton(this);
		this.root = createRoot(el);
		this.root.render(<div className="pane"><CodeTabs /></div>);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}

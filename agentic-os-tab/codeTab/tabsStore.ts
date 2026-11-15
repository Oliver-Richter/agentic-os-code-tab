import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { makeUUID, type ChatTab } from "../loadChatTabs";

/**
 * Tabs of the Code view. Own file (~/.agentic-os/code-tabs.json) so the Code view
 * and the chat drawer of the dashboard never overwrite each other's state.
 */

export type CodeTab = ChatTab;

export interface CodeTabsState {
	tabs: CodeTab[];
	activeId: string | null;
}

export const MAX_TABS = 10;

const DIR = join(homedir(), ".agentic-os");
const FILE = join(DIR, "code-tabs.json");

function fresh(): CodeTabsState {
	const id = makeUUID();
	return { tabs: [{ id, name: "claude", type: "claude", workspace: "home" }], activeId: id };
}

function isTab(t: unknown): t is CodeTab {
	if (t === null || typeof t !== "object") return false;
	const o = t as Record<string, unknown>;
	return typeof o.id === "string" && typeof o.name === "string" && (o.type === "claude" || o.type === "agent");
}

export function codeSessionName(tab: CodeTab): string {
	return `code-${tab.id}`;
}

export function loadCodeTabs(): CodeTabsState {
	try {
		if (!existsSync(FILE)) return fresh();
		const raw = JSON.parse(readFileSync(FILE, "utf-8")) as { tabs?: unknown; activeId?: unknown };
		const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter(isTab) : [];
		if (tabs.length === 0) return fresh();
		const activeId = typeof raw.activeId === "string" && tabs.some((t) => t.id === raw.activeId)
			? raw.activeId
			: (tabs[0]?.id ?? null);
		return { tabs, activeId };
	} catch (e) {
		console.error("[agentic-os-code-tab] code-tabs.json unreadable:", e);
		return fresh();
	}
}

export function saveCodeTabs(state: CodeTabsState): void {
	try {
		if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
		writeFileSync(FILE, JSON.stringify(state, null, 2), "utf-8");
	} catch (e) {
		console.error("[agentic-os-code-tab] code-tabs.json not writable:", e);
	}
}

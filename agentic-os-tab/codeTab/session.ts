import { homeDir, vaultRoot } from "../platform";
import { spawnSession, writeRaw, paste, sessionExists } from "../ptySession";
import { getSettings } from "./settings";
import { codeSessionName, type CodeTab } from "./tabsStore";

/** Env var the statusline sidecar script uses to find the JSON file of this tab. */
export const SESSION_ENV = "AGENTIC_OS_SESSION";

/** Working directory of a tab: explicit cwd, else vault, else the configured start folder. */
export function tabCwd(tab: CodeTab): string {
	if (tab.cwd !== undefined && tab.cwd.length > 0) return tab.cwd;
	const vault = vaultRoot();
	if (tab.workspace === "vault" && vault.length > 0) return vault;
	return getSettings().startDir || homeDir;
}

/**
 * Spawns claude for a Code tab via the upstream session manager.
 * The upstream spawnSession() builds the env from process.env synchronously,
 * so the session name is set there for exactly this call and restored afterwards.
 */
export function spawnCodeSession(tab: CodeTab): { ok: boolean; error?: string } {
	const name = codeSessionName(tab);
	const prev = process.env[SESSION_ENV];
	process.env[SESSION_ENV] = name;
	try {
		return spawnSession({
			sessionName: name,
			agentName: tab.type === "agent" ? tab.agentName : undefined,
			workspace: tab.workspace,
			cwd: tabCwd(tab),
			dangerous: tab.dangerous === true,
		});
	} finally {
		if (prev === undefined) delete process.env[SESSION_ENV];
		else process.env[SESSION_ENV] = prev;
	}
}

/**
 * Sends text + Enter. Enter comes 250 ms later: claude's TUI otherwise sometimes
 * swallows the Enter of a fast paste and the message stays in the input box.
 */
export function sendText(name: string, text: string): { ok: boolean; error?: string } {
	if (!sessionExists(name)) return { ok: false, error: "Terminal läuft nicht" };
	if (text.includes("\n")) paste(name, text);
	else writeRaw(name, text);
	window.setTimeout(() => {
		if (sessionExists(name)) writeRaw(name, "\r");
	}, 250);
	return { ok: true };
}

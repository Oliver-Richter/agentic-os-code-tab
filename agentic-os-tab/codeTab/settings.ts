import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Settings of the Code tab, stored in ~/.agentic-os/code-tab.json (outside the
 * plugin folder, so plugin updates keep them).
 */

export type ThemeMode = "auto" | "dark" | "light";

export interface CodeTabSettings {
	/** Working directory for new neutral tabs and start folder of the folder browser. */
	startDir: string;
	themeMode: ThemeMode;
}

const DIR = join(homedir(), ".agentic-os");
export const SETTINGS_FILE = join(DIR, "code-tab.json");

const DEFAULTS: CodeTabSettings = { startDir: homedir(), themeMode: "auto" };

let cache: CodeTabSettings | null = null;
const listeners = new Set<(s: CodeTabSettings) => void>();

function isDir(p: string): boolean {
	try { return statSync(p).isDirectory(); } catch (_) { return false; }
}

function sanitize(raw: unknown): CodeTabSettings {
	const out: CodeTabSettings = { ...DEFAULTS };
	if (raw === null || typeof raw !== "object") return out;
	const o = raw as Record<string, unknown>;
	if (typeof o.startDir === "string" && o.startDir.trim().length > 0 && isDir(o.startDir.trim())) {
		out.startDir = o.startDir.trim();
	}
	if (o.themeMode === "auto" || o.themeMode === "dark" || o.themeMode === "light") out.themeMode = o.themeMode;
	return out;
}

export function getSettings(): CodeTabSettings {
	if (cache !== null) return cache;
	try {
		cache = existsSync(SETTINGS_FILE) ? sanitize(JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"))) : { ...DEFAULTS };
	} catch (e) {
		console.warn("[agentic-os-code-tab] code-tab.json unreadable, using defaults:", e);
		cache = { ...DEFAULTS };
	}
	return cache;
}

/** Saves a patch. Throws with a readable message if the folder does not exist or the file cannot be written. */
export function saveSettings(patch: Partial<CodeTabSettings>): CodeTabSettings {
	if (patch.startDir !== undefined && !isDir(patch.startDir)) {
		throw new Error(`Ordner existiert nicht: ${patch.startDir}`);
	}
	const next = sanitize({ ...getSettings(), ...patch });
	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
	writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n", "utf-8");
	cache = next;
	listeners.forEach((fn) => {
		try { fn(next); } catch (_) { /* one broken listener must not stop the others */ }
	});
	return next;
}

export function onSettingsChange(fn: (s: CodeTabSettings) => void): () => void {
	listeners.add(fn);
	return () => { listeners.delete(fn); };
}

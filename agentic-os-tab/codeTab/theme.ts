import { setIcon, type ItemView } from "obsidian";
import type { ITheme, Terminal } from "@xterm/xterm";
import { getTerminalSettings, onTerminalSettingsChange } from "../terminalSettings";
import { getSettings, onSettingsChange, saveSettings } from "./settings";

/**
 * Light/dark theme of the Code view.
 * - "auto" follows Obsidian (body.theme-light), "dark"/"light" are fixed.
 * - Dark uses the terminal colors from the Agentic OS settings, light uses LIGHT_THEME.
 * - The body class only switches CSS scoped to .agentic-os-code-leaf, other views stay as they are.
 */

export const LIGHT_BODY_CLASS = "aos-code-light";

const LIGHT_THEME: Readonly<ITheme> = Object.freeze({
	background: "#f7f6f4",
	foreground: "#1a1714",
	cursor: "#E0560C",
	cursorAccent: "#ffffff",
	selectionBackground: "#f6d3bc",
	black: "#1a1714",
	red: "#c62828",
	green: "#15803d",
	yellow: "#a16207",
	blue: "#1d4ed8",
	magenta: "#7e22ce",
	cyan: "#0e7490",
	white: "#a8a29e",
	brightBlack: "#78716c",
	brightRed: "#dc2626",
	brightGreen: "#16a34a",
	brightYellow: "#b45309",
	brightBlue: "#2563eb",
	brightMagenta: "#9333ea",
	brightCyan: "#0891b2",
	brightWhite: "#57534e",
});

const terms = new Set<Terminal>();
const buttons = new Set<HTMLElement>();

export function isLight(): boolean {
	const mode = getSettings().themeMode;
	return mode === "light" || (mode === "auto" && document.body.classList.contains("theme-light"));
}

export function xtermTheme(): ITheme {
	return isLight() ? { ...LIGHT_THEME } : getTerminalSettings().theme;
}

function syncButtons(): void {
	const light = isLight();
	for (const el of buttons) {
		if (!el.isConnected) { buttons.delete(el); continue; }
		setIcon(el, light ? "moon" : "sun");
		el.setAttribute("aria-label", light ? "Dunkles Farbschema" : "Helles Farbschema");
	}
}

export function applyTheme(): void {
	document.body.classList.toggle(LIGHT_BODY_CLASS, isLight());
	const theme = xtermTheme();
	for (const t of terms) {
		try { t.options.theme = theme; } catch (_) { /* disposed terminal */ }
	}
	syncButtons();
}

export function registerTerminal(t: Terminal): () => void {
	terms.add(t);
	return () => { terms.delete(t); };
}

export function toggleTheme(): void {
	saveSettings({ themeMode: isLight() ? "dark" : "light" });
}

export function addThemeButton(view: ItemView): void {
	const el = view.addAction("sun", "Farbschema", () => {
		try {
			toggleTheme();
		} catch (e) {
			console.error("[agentic-os-code-tab] theme not saved:", e);
		}
	});
	buttons.add(el);
	syncButtons();
}

/** Starts theme tracking. Returns the cleanup for plugin unload. */
export function startTheme(): () => void {
	applyTheme();
	const mo = new MutationObserver(() => applyTheme());
	mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
	const offSettings = onSettingsChange(() => applyTheme());
	const offTerminal = onTerminalSettingsChange(() => applyTheme());
	return () => {
		mo.disconnect();
		offSettings();
		offTerminal();
		document.body.classList.remove(LIGHT_BODY_CLASS);
		buttons.clear();
		terms.clear();
	};
}

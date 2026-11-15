import * as React from "react";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getPtySession, paste as ptyPaste, type PtyHandle } from "../ptySession";
import { getTerminalSettings, onTerminalSettingsChange } from "../terminalSettings";
import { registerTerminal, xtermTheme } from "./theme";

const IS_MAC = process.platform === "darwin";

interface Props {
	sessionName: string;
	/** true once the pty session runs */
	ready: boolean;
	/** a React modal of the pane is open: do not pull the focus back into the terminal */
	overlayOpen: boolean;
}

/** Terminal background follows the active theme (light palette or the user's dark terminal colors). */
function applyBackground(el: HTMLElement | null): void {
	if (el === null) return;
	const bg = xtermTheme().background;
	if (bg !== undefined) el.style.setProperty("--agentic-os-term-bg", bg);
}

function electronClipboard(): { readText?: () => string; writeText?: (t: string) => void } | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require("electron")?.clipboard ?? null;
	} catch (_) { return null; }
}

function electronWebUtils(): { getPathForFile: (f: File) => string } | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const wu = require("electron")?.webUtils;
		if (wu !== undefined && typeof wu.getPathForFile === "function") return wu;
	} catch (_) { /* not in electron */ }
	return null;
}

/** Paths from a drop: Electron file paths, then file:// URIs, then a plain path string. */
function extractPaths(dt: DataTransfer): string[] {
	const paths: string[] = [];
	const wu = electronWebUtils();
	for (let i = 0; i < (dt.files?.length ?? 0); i++) {
		const f = dt.files[i];
		if (f === undefined) continue;
		const legacy = (f as File & { path?: string }).path;
		if (typeof legacy === "string" && legacy.length > 0) { paths.push(legacy); continue; }
		if (wu !== null) {
			try {
				const p = wu.getPathForFile(f);
				if (p.length > 0) paths.push(p);
			} catch (e) { console.warn("[agentic-os-code-tab] getPathForFile failed:", e); }
		}
	}
	if (paths.length === 0) {
		for (const u of dt.getData("text/uri-list").split(/\r?\n/)) {
			const t = u.trim();
			if (!t.startsWith("file://")) continue;
			try {
				let p = decodeURIComponent(t.replace(/^file:\/\//, ""));
				if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
				paths.push(p);
			} catch (_) { /* malformed uri */ }
		}
	}
	if (paths.length === 0) {
		const plain = dt.getData("text/plain");
		if (plain.length > 0 && !plain.includes("\n") && (plain.startsWith("/") || /^[A-Za-z]:[\\/]/.test(plain) || plain.startsWith("\\\\"))) {
			paths.push(plain);
		}
	}
	return paths;
}

/**
 * Live claude TUI via xterm.js on the shared pty session.
 * Based on the upstream XtermPane, plus: theme switching and keeping the focus
 * in the terminal after clicks elsewhere in the view.
 */
export function CodeXterm({ sessionName, ready, overlayOpen }: Props): JSX.Element {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const sessionRef = useRef<PtyHandle | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (container === null) return;
		const term = new Terminal({
			fontFamily: "JetBrainsMono, 'JetBrains Mono', ui-monospace, Menlo, monospace",
			fontSize: getTerminalSettings().fontSize,
			lineHeight: 1.25,
			theme: xtermTheme(),
			cursorBlink: true,
			disableStdin: false,
			scrollback: 5000,
			convertEol: true,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);
		try { fit.fit(); } catch (_) { /* not visible yet */ }
		termRef.current = term;
		applyBackground(wrapRef.current);
		const unregister = registerTerminal(term);

		const dataSub = term.onData((data) => { sessionRef.current?.write(data); });

		let lastPasteAt = 0;
		const sendPaste = (text: string): void => {
			if (text.length === 0) return;
			const now = Date.now();
			if (now - lastPasteAt < 200) return; // several handlers fire for one paste
			lastPasteAt = now;
			ptyPaste(sessionName, text.replace(/\r\n?/g, "\n"));
		};
		const sendRaw = (bytes: string): void => { sessionRef.current?.write(bytes); };

		term.attachCustomKeyEventHandler((ev) => {
			if (ev.type !== "keydown") return true;
			const key = ev.key.toLowerCase();
			const cb = electronClipboard();
			if (IS_MAC) {
				if (ev.metaKey && !ev.altKey && !ev.shiftKey && !ev.ctrlKey) {
					if (key === "backspace") { sendRaw("\x15"); ev.preventDefault(); return false; }
					if (key === "arrowleft") { sendRaw("\x01"); ev.preventDefault(); return false; }
					if (key === "arrowright") { sendRaw("\x05"); ev.preventDefault(); return false; }
					if (key === "v") { sendPaste(cb?.readText?.() ?? ""); ev.preventDefault(); return false; }
					if (key === "c" && term.hasSelection()) { cb?.writeText?.(term.getSelection()); ev.preventDefault(); return false; }
					if (key === "a") { term.selectAll(); ev.preventDefault(); return false; }
				}
				if (ev.altKey && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
					if (key === "backspace") { sendRaw("\x17"); ev.preventDefault(); return false; }
					if (key === "arrowleft") { sendRaw("\x1bb"); ev.preventDefault(); return false; }
					if (key === "arrowright") { sendRaw("\x1bf"); ev.preventDefault(); return false; }
				}
				return true;
			}
			if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
				if (key === "v") { sendPaste(cb?.readText?.() ?? ""); ev.preventDefault(); return false; }
				if (key === "c" && ev.shiftKey && term.hasSelection()) { cb?.writeText?.(term.getSelection()); ev.preventDefault(); return false; }
			}
			return true;
		});

		const onDomPaste = (ev: ClipboardEvent): void => {
			ev.preventDefault();
			sendPaste(ev.clipboardData?.getData("text/plain") ?? "");
		};
		const onDomCopy = (ev: ClipboardEvent): void => {
			const sel = term.getSelection();
			if (sel.length === 0) return;
			ev.preventDefault();
			ev.clipboardData?.setData("text/plain", sel);
		};
		container.addEventListener("paste", onDomPaste);
		container.addEventListener("copy", onDomCopy);

		// Drop files from Finder/Explorer/Obsidian → "@<path>" mention. Capture phase runs before Obsidian's handler.
		const inside = (t: EventTarget | null): boolean => t instanceof Node && container.contains(t);
		const onDragEnter = (ev: DragEvent): void => { if (inside(ev.target)) { ev.preventDefault(); ev.stopPropagation(); } };
		const onDragOver = (ev: DragEvent): void => {
			if (!inside(ev.target)) return;
			ev.preventDefault(); ev.stopPropagation();
			if (ev.dataTransfer !== null) ev.dataTransfer.dropEffect = "copy";
		};
		const onDrop = (ev: DragEvent): void => {
			if (!inside(ev.target) || ev.dataTransfer === null) return;
			// Tabs of the tab bar are dragged too: ignore them here.
			if (Array.from(ev.dataTransfer.types).includes("application/x-aos-code-tab")) return;
			ev.preventDefault(); ev.stopPropagation();
			const paths = extractPaths(ev.dataTransfer);
			if (paths.length === 0) return;
			sendPaste(paths.map((p) => (p.includes(" ") || p.includes("\\") ? `@"${p}"` : `@${p}`)).join(" ") + " ");
		};
		document.addEventListener("dragenter", onDragEnter, true);
		document.addEventListener("dragover", onDragOver, true);
		document.addEventListener("drop", onDrop, true);

		const focusTimer = window.setTimeout(() => { try { term.focus(); } catch (_) { /* disposed */ } }, 100);

		const syncSize = (): void => {
			const s = sessionRef.current;
			// inactive tabs report 0×0: resizing the pty to that would break the TUI
			if (s !== null && term.cols > 0 && term.rows > 0) s.resize(term.cols, term.rows);
		};
		const ro = new ResizeObserver(() => {
			try { fit.fit(); } catch (_) { /* hidden */ }
			syncSize();
		});
		ro.observe(container);
		const sizeTimer = window.setTimeout(syncSize, 200);

		const offSettings = onTerminalSettingsChange((s) => {
			term.options.fontSize = s.fontSize;
			applyBackground(wrapRef.current);
			try { fit.fit(); } catch (_) { /* hidden */ }
			syncSize();
		});
		// Theme switches also change the terminal background of the wrapper.
		const mo = new MutationObserver(() => applyBackground(wrapRef.current));
		mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });

		return () => {
			window.clearTimeout(focusTimer);
			window.clearTimeout(sizeTimer);
			mo.disconnect();
			offSettings();
			ro.disconnect();
			dataSub.dispose();
			container.removeEventListener("paste", onDomPaste);
			container.removeEventListener("copy", onDomCopy);
			document.removeEventListener("dragenter", onDragEnter, true);
			document.removeEventListener("dragover", onDragOver, true);
			document.removeEventListener("drop", onDrop, true);
			unregister();
			term.dispose();
			termRef.current = null;
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Attach to the pty: replay ring + live stream + exit line.
	useEffect(() => {
		if (!ready) return;
		const term = termRef.current;
		if (term === null) return;
		const session = getPtySession(sessionName);
		if (session === null) {
			console.error("[agentic-os-code-tab] no pty session for", sessionName);
			return;
		}
		sessionRef.current = session;
		const detach = session.attach((chunk) => { termRef.current?.write(chunk); });
		const offExit = session.onExit((code) => {
			termRef.current?.write(`\r\n\x1b[2m[session ended, exit ${code}]\x1b[0m\r\n`);
		});
		const t = window.setTimeout(() => {
			if (term.cols > 0 && term.rows > 0) session.resize(term.cols, term.rows);
		}, 50);
		return () => {
			window.clearTimeout(t);
			detach();
			offExit();
			sessionRef.current = null;
		};
	}, [ready, sessionName]);

	// Focus keeper: after clicks in the tab bar/status bar or a leaf switch the terminal gets
	// the focus back, unless a modal/menu is open, an input is focused or text is selected.
	useEffect(() => {
		const host = wrapRef.current;
		if (host === null) return;
		if (overlayOpen) {
			try { termRef.current?.blur(); } catch (_) { /* disposed */ }
			return;
		}
		const back = window.setTimeout(() => { try { termRef.current?.focus(); } catch (_) { /* disposed */ } }, 10);
		const leafEl = host.closest(".workspace-leaf");
		const editable = (el: Element | null): boolean => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
		let timer = 0;
		let pointerDown = false;
		const grab = (): void => {
			const term = termRef.current;
			if (term === null || !host.isConnected || host.offsetParent === null || !document.hasFocus()) return;
			if (leafEl !== null && !leafEl.classList.contains("mod-active")) return;
			if (document.querySelector(".modal-container, .menu, .suggestion-container") !== null) return;
			const a = document.activeElement;
			if ((a !== null && host.contains(a)) || editable(a)) return;
			const sel = window.getSelection();
			if (sel !== null && !sel.isCollapsed && sel.toString().length > 0) return;
			try { term.focus(); } catch (_) { /* disposed */ }
		};
		const schedule = (ms: number): void => { window.clearTimeout(timer); timer = window.setTimeout(grab, ms); };
		const onOut = (): void => { if (!pointerDown) schedule(30); };
		const onDown = (): void => { pointerDown = true; };
		const onUp = (): void => { pointerDown = false; schedule(80); };
		const onWin = (): void => schedule(50);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ws = (window as any).app?.workspace;
		const ref = ws !== undefined ? ws.on("active-leaf-change", () => schedule(50)) : null;
		host.addEventListener("focusout", onOut);
		document.addEventListener("pointerdown", onDown, true);
		document.addEventListener("pointerup", onUp, true);
		window.addEventListener("focus", onWin);
		return () => {
			window.clearTimeout(back);
			window.clearTimeout(timer);
			host.removeEventListener("focusout", onOut);
			document.removeEventListener("pointerdown", onDown, true);
			document.removeEventListener("pointerup", onUp, true);
			window.removeEventListener("focus", onWin);
			if (ref !== null) ws.offref(ref);
		};
	}, [overlayOpen]);

	return (
		<div ref={wrapRef} className="xterm-pane-wrap">
			<div ref={containerRef} className="xterm-pane" />
		</div>
	);
}

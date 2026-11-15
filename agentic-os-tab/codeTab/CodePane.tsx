import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPlainBuffer, killSession, parseTmuxChat, sendKey, sessionExists, type StatusInfo } from "../ptySession";
import type { SlashCommand } from "../loadCommands";
import { SelectModal } from "../SelectModal";
import { PluginMarketplaceModal } from "../PluginMarketplaceModal";
import type { CodeStatus } from "./claudeInfo";
import { CodeStatusBar } from "./CodeStatusBar";
import { CodeXterm } from "./CodeXterm";
import { ContextModal, effortOptions, HelpModal, modelOptions, permissionOptions } from "./CodeModals";
import { sendText, spawnCodeSession, tabCwd } from "./session";
import { codeSessionName, type CodeTab } from "./tabsStore";

const POLL_MS = 250;

/**
 * Permission mode by Shift+Tab cycling (claude: auto → default → acceptEdits → plan → auto;
 * without auto: default → acceptEdits → plan). Index steps work for both cycles.
 */
const PERMISSION_CYCLE = ["auto", "default", "acceptEdits", "plan"];

function cyclePermission(name: string, target: string, current?: string): void {
	const cur = current === undefined || current === "" || current === "?" ? "default" : current;
	if (cur === target) return;
	const ci = PERMISSION_CYCLE.indexOf(cur);
	const ti = PERMISSION_CYCLE.indexOf(target);
	if (ci === -1 || ti === -1) { console.warn("[agentic-os-code-tab] unknown permission mode:", cur, target); return; }
	const steps = (ti - ci + PERMISSION_CYCLE.length) % PERMISSION_CYCLE.length;
	for (let i = 0; i < steps; i++) window.setTimeout(() => sendKey(name, "BTab"), i * 250);
}

/** /model and /effort may open a confirm dialog in the TUI; its default is "yes". */
function sendWithConfirm(name: string, cmd: string): void {
	const r = sendText(name, cmd);
	if (!r.ok) { console.error("[agentic-os-code-tab] command failed:", r.error); return; }
	window.setTimeout(() => sendKey(name, "Enter"), 1150);
	window.setTimeout(() => sendKey(name, "Enter"), 2050);
}

type Modal = "none" | "help" | "model" | "effort" | "permissions" | "context" | "plugins";

interface Props {
	tab: CodeTab;
	commands: SlashCommand[];
	onTabPatch: (patch: Partial<CodeTab>) => void;
}

export function CodePane({ tab, commands, onTabPatch }: Props): JSX.Element {
	const name = codeSessionName(tab);
	const [parsed, setParsed] = useState<StatusInfo>({});
	const [status, setStatus] = useState<CodeStatus>({});
	const [modalStuck, setModalStuck] = useState<boolean>(false);
	const [modalHint, setModalHint] = useState<string | undefined>(undefined);
	const [ready, setReady] = useState<boolean>(false);
	const [spawnError, setSpawnError] = useState<string | null>(null);
	const [resetKey, setResetKey] = useState<number>(0);
	const [modal, setModal] = useState<Modal>("none");
	const lastCapture = useRef<string>("");

	useEffect(() => {
		if (!sessionExists(name)) {
			const r = spawnCodeSession(tab);
			if (!r.ok) { setSpawnError(r.error ?? "unbekannter Fehler"); return; }
		}
		const iv = window.setInterval(() => {
			const raw = getPlainBuffer(name);
			if (raw.length === 0 || raw === lastCapture.current) return;
			lastCapture.current = raw;
			const p = parseTmuxChat(raw);
			setModalStuck(p.modalStuck ?? false);
			setModalHint(p.modalHint);
			if (p.status !== undefined) {
				const st = p.status;
				setParsed((prev) => {
					const next: StatusInfo = { ...prev };
					for (const k of Object.keys(st) as (keyof StatusInfo)[]) {
						const v = st[k];
						if (v !== undefined) (next as Record<string, unknown>)[k] = v;
					}
					return next;
				});
			}
			if (p.messages.length > 0 || raw.includes("❯")) setReady(true);
		}, POLL_MS);
		return () => window.clearInterval(iv);
	}, [name, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

	/** Kill + respawn (after /clear via picker, bypass switch). */
	const respawn = useCallback((patched: CodeTab): void => {
		killSession(name);
		lastCapture.current = "";
		setReady(false);
		setParsed({});
		setSpawnError(null);
		window.setTimeout(() => {
			const r = spawnCodeSession(patched);
			if (!r.ok) setSpawnError(r.error ?? "unbekannter Fehler");
			setResetKey((k) => k + 1);
		}, 100);
	}, [name]);

	const send = useCallback((text: string): void => {
		const r = sendText(name, text);
		if (!r.ok) console.error("[agentic-os-code-tab] send failed:", r.error);
	}, [name]);

	// ESC goes to claude (Obsidian would otherwise react to it); with a stuck TUI dialog also arrows + Enter.
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const t = e.target as HTMLElement | null;
			if (t === null || typeof t.closest !== "function" || t.closest(".agentic-os-code-leaf") === null) return;
			if (modal !== "none" || document.querySelector(".modal-container") !== null) return;
			if (e.key === "Escape") {
				e.preventDefault(); e.stopPropagation();
				sendKey(name, "Escape");
				sendKey(name, "Escape");
				return;
			}
			if (!modalStuck) return;
			const isText = t.tagName === "TEXTAREA" || t.tagName === "INPUT";
			if (isText && (t as HTMLInputElement).value !== "") return;
			const map: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter" };
			const k = map[e.key];
			if (k !== undefined) { e.preventDefault(); e.stopPropagation(); sendKey(name, k); }
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [name, modalStuck, modal]);

	const close = useCallback((): void => setModal("none"), []);
	const cwd = tabCwd(tab);

	return (
		<div className="chat-pane">
			{spawnError !== null ? (
				<div className="chat-bubble system ct-spawn-error">
					<div className="bubble-meta"><span className="mono small-caps">FEHLER</span></div>
					<div className="bubble-text">Terminal-Start fehlgeschlagen: {spawnError}</div>
				</div>
			) : (
				<CodeXterm key={`${name}-${resetKey}`} sessionName={name} ready={ready} overlayOpen={modal !== "none"} />
			)}
			<CodeStatusBar
				parsed={parsed}
				sessionName={name}
				gitCwd={cwd}
				dangerous={tab.dangerous === true}
				onOpenModel={() => setModal("model")}
				onOpenEffort={() => setModal("effort")}
				onOpenPermissions={() => setModal("permissions")}
				onOpenContext={() => setModal("context")}
				onOpenHelp={() => setModal("help")}
				onOpenPlugins={() => setModal("plugins")}
				onStatus={setStatus}
			/>
			{modalStuck && (
				<div className="modal-stuck-banner">
					<div className="modal-stuck-info">
						<span className="modal-stuck-label">⚠ CLAUDE WARTET AUF NAVIGATION</span>
						{modalHint !== undefined && <span className="modal-stuck-hint">{modalHint}</span>}
					</div>
					<div className="modal-stuck-actions">
						<button title="↑" onClick={() => sendKey(name, "Up")}>↑</button>
						<button title="↓" onClick={() => sendKey(name, "Down")}>↓</button>
						<button title="Enter" onClick={() => sendKey(name, "Enter")}>↵</button>
						<button title="y" onClick={() => sendKey(name, "y")}>y</button>
						<button title="n" onClick={() => sendKey(name, "n")}>n</button>
						<button title="ESC" className="modal-esc" onClick={() => { sendKey(name, "Escape"); sendKey(name, "Escape"); }}>ESC</button>
					</div>
				</div>
			)}

			{modal === "help" && <HelpModal commands={commands} onClose={close} />}
			{modal === "model" && (
				<SelectModal
					title="MODELL WECHSELN"
					subtitle="Auswahl wird sofort angewendet"
					options={modelOptions(status.model)}
					onSelect={(v) => { close(); sendWithConfirm(name, "/model " + v); }}
					onClose={close}
				/>
			)}
			{modal === "effort" && (
				<SelectModal
					title="THINKING-EFFORT"
					subtitle="Mehr Effort = mehr Reasoning, höhere Kosten"
					options={effortOptions(status.effort)}
					onSelect={(v) => { close(); sendWithConfirm(name, "/effort " + v); }}
					onClose={close}
				/>
			)}
			{modal === "permissions" && (
				<SelectModal
					title="PERMISSION-MODUS"
					subtitle="Bestimmt, wann Claude vor Tool-Calls fragt"
					options={permissionOptions(tab.dangerous === true ? "bypass" : status.permissionMode)}
					onSelect={(v) => {
						close();
						const wasBypass = tab.dangerous === true;
						const toBypass = v === "bypass";
						if (toBypass !== wasBypass) {
							onTabPatch({ dangerous: toBypass });
							respawn({ ...tab, dangerous: toBypass });
						} else if (!toBypass) {
							cyclePermission(name, v, status.permissionMode);
						}
					}}
					onClose={close}
				/>
			)}
			{modal === "context" && (
				<ContextModal
					status={status}
					cwd={cwd}
					onClose={close}
					onCompact={() => { close(); send("/compact"); }}
					onSend={send}
					onLoadHandoff={(prompt) => {
						const r = sendText(name, "/clear");
						if (!r.ok) { console.error("[agentic-os-code-tab] /clear failed:", r.error); return; }
						window.setTimeout(() => send(prompt), 1500);
					}}
				/>
			)}
			{modal === "plugins" && (
				<PluginMarketplaceModal onClose={close} onInstall={(cmd) => { close(); send(cmd); }} />
			)}
		</div>
	);
}

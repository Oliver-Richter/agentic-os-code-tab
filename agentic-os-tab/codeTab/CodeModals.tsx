import * as React from "react";
import type { SelectOption } from "../SelectModal";
import type { SlashCommand } from "../loadCommands";
import type { CodeStatus } from "./claudeInfo";
import { HandoffSection } from "./Handoff";
import { ModalFrame } from "./StatusModals";

/**
 * Models offered in the MODEL picker. Update this list when new models ship;
 * value is passed to `/model <value>`.
 */
const MODELS: Array<{ value: string; label: string; match: RegExp; description: string; color: string }> = [
	{ value: "claude-fable-5-2", label: "Fable 5.2", match: /fable/i, description: "Neuestes Modell der Claude-5-Familie.", color: "var(--c-f472b6)" },
	{ value: "claude-opus-5-5", label: "Opus 5.5", match: /opus/i, description: "Höchste Qualität, langsamer, teurer. Für komplexe Aufgaben.", color: "var(--c-c084fc)" },
	{ value: "claude-sonnet-5-5", label: "Sonnet 5.5", match: /sonnet/i, description: "Ausgewogen. Fast jede Aufgabe, schneller als Opus.", color: "var(--c-60a5fa)" },
	{ value: "claude-haiku-5-5", label: "Haiku 5.5", match: /haiku/i, description: "Schnell und günstig. Für einfache Aufgaben.", color: "var(--green)" },
];

export function modelOptions(active?: string): SelectOption[] {
	return MODELS.map((m) => ({ value: m.value, label: m.label, description: m.description, color: m.color, active: active !== undefined && m.match.test(active) }));
}

export function effortOptions(active?: string): SelectOption[] {
	return [
		{ value: "none", label: "none", description: "Kein extended thinking. Schnellste Antworten." },
		{ value: "minimal", label: "minimal", description: "Sehr kurzes Reasoning." },
		{ value: "medium", label: "medium", description: "Solide Antworten ohne Übergewicht (Standard für meiste Tasks)." },
		{ value: "high", label: "high", description: "Tiefes Reasoning. Für anspruchsvolle Probleme." },
		{ value: "xhigh", label: "xhigh", description: "Zwischen high und max." },
		{ value: "max", label: "max", description: "Maximal extended thinking. Höchste Kosten, langsamste Antworten." },
	].map((o) => ({ ...o, active: active === o.value }));
}

export function permissionOptions(active?: string): SelectOption[] {
	return [
		{ value: "default", label: "default", description: "Claude fragt vor jedem Tool-Call.", color: "var(--c-88aaaa)" },
		{ value: "acceptEdits", label: "acceptEdits", description: "Datei-Änderungen ohne Rückfrage. Bash und Tests fragen.", color: "var(--c-60a5fa)" },
		{ value: "auto", label: "auto", description: "Weitgehend automatisch (je nach Plan verfügbar).", color: "var(--green)" },
		{ value: "plan", label: "plan", description: "Nur lesen. Claude plant, ändert aber nichts.", color: "var(--c-fbbf24)" },
		{ value: "bypass", label: "bypass (YOLO ⚠)", description: "--dangerously-skip-permissions: keine einzige Rückfrage. Tab startet neu. Nur in abgeschotteten Umgebungen.", color: "var(--red)" },
	].map((o) => ({ ...o, active: active === o.value }));
}

function ctxColor(pct: number): string {
	return pct >= 80 ? "var(--red)" : pct >= 60 ? "var(--c-fbbf24)" : "var(--accent)";
}

export function ContextModal({ status, cwd, onClose, onCompact, onSend, onLoadHandoff }: {
	status: CodeStatus;
	cwd: string;
	onClose: () => void;
	onCompact: () => void;
	onSend: (prompt: string) => void;
	onLoadHandoff: (prompt: string) => void;
}): JSX.Element {
	const pct = status.contextPercent ?? 0;
	return (
		<ModalFrame title="CONTEXT-WINDOW" className="ct-context" onClose={onClose}>
			<div className="ct-context-body" style={{ ["--ct-color" as string]: ctxColor(pct) }}>
				<div className="ct-context-pct mono">{pct}%</div>
				<div className="ct-context-sub mono">vom maximalen Context belegt</div>
				<div className="ct-context-bar"><div className="ct-context-fill" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
				<div className="ct-context-model mono">Modell: <span>{status.model ?? "?"}</span></div>
				{pct >= 60 && (
					<button className="ct-context-compact mono" onClick={onCompact}>/COMPACT JETZT (Conversation komprimieren)</button>
				)}
				<HandoffSection cwd={cwd} onSend={(p) => { onSend(p); onClose(); }} onLoad={(p) => { onClose(); onLoadHandoff(p); }} />
			</div>
		</ModalFrame>
	);
}

export function HelpModal({ commands, onClose }: { commands: SlashCommand[]; onClose: () => void }): JSX.Element {
	const groups: Array<{ key: SlashCommand["source"]; label: string }> = [
		{ key: "builtin", label: "BUILT-IN" },
		{ key: "user", label: "DEINE COMMANDS" },
		{ key: "plugin", label: "PLUGIN COMMANDS" },
	];
	return (
		<ModalFrame title={`HELP · ${commands.length} COMMANDS`} className="aos-modal-col ct-help" onClose={onClose}>
			<div className="aos-modal-scroll">
				{groups.map((g) => {
					const list = commands.filter((c) => c.source === g.key);
					return (
						<div key={g.key}>
							<div className="ct-help-group mono small-caps">{g.label} ({list.length})</div>
							{list.map((c) => (
								<div key={c.name} className="ct-help-row">
									<span className="ct-help-name mono">{c.name}</span>
									<span className="ct-help-desc mono">{c.description}</span>
								</div>
							))}
						</div>
					);
				})}
			</div>
		</ModalFrame>
	);
}

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { spawn } from "child_process";
import { claudeBinary, spawnEnv } from "../platform";
import {
	cachedLatestVersion, compareVersions, formatReset, latestClaudeVersion, limitPercent,
	type CodeStatus, type PlanInfo,
} from "./claudeInfo";

/** Closes on Escape. Capture phase, so the terminal does not get the key. */
export function useEscape(onClose: () => void): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);
}

/** Overlay + card + header with × + footer with SCHLIEßEN. */
export function ModalFrame({ title, onClose, className, footer, children }: {
	title: string;
	onClose: () => void;
	className?: string;
	footer?: React.ReactNode;
	children: React.ReactNode;
}): JSX.Element {
	useEscape(onClose);
	return (
		<div className="agent-picker-overlay" onClick={onClose}>
			<div className={"agent-picker select-modal " + (className ?? "")} onClick={(e) => e.stopPropagation()}>
				<div className="select-modal-header">
					<span className="aos-tok-title mono small-caps">{title}</span>
					<button className="aos-modal-x" title="Schließen" aria-label="Schließen" onClick={onClose}>×</button>
				</div>
				{children}
				<div className="select-modal-footer aos-cv-foot">
					{footer}
					<button className="aos-modal-close mono" onClick={onClose}>SCHLIEßEN</button>
				</div>
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="aos-plan-row">
			<span className="aos-tok-lbl mono small-caps">{label}</span>
			<span className="aos-plan-val mono">{value.length > 0 ? value : "—"}</span>
		</div>
	);
}

function LimitRow({ label, percent, resetsAt }: { label: string; percent?: number; resetsAt?: number }): JSX.Element {
	const v = limitPercent(percent, resetsAt);
	const lvl = v === undefined ? "" : v >= 80 ? " crit" : v >= 60 ? " warn" : "";
	return (
		<div className="aos-tok-row">
			<div className="aos-tok-head">
				<span className="aos-tok-lbl mono small-caps">{label}</span>
				<span className={"aos-tok-val mono tnum" + lvl}>{v !== undefined ? `${v}%` : "—"}</span>
			</div>
			<div className="aos-tok-bar">
				<div className={"aos-tok-fill" + lvl} style={{ width: `${v !== undefined ? Math.min(v, 100) : 0}%` }} />
			</div>
			<div className="aos-tok-reset mono">
				{v === undefined ? "Keine Daten, erst nach der ersten Antwort verfügbar" : resetsAt !== undefined ? "Reset: " + formatReset(resetsAt) : "Reset: unbekannt"}
			</div>
		</div>
	);
}

export function LimitsModal({ status, onClose }: { status: CodeStatus; onClose: () => void }): JSX.Element {
	return (
		<ModalFrame title="PLAN-NUTZUNG" className="aos-tok" onClose={onClose}>
			<div className="aos-tok-body">
				<LimitRow label="5H-FENSTER" percent={status.fiveHourPercent} resetsAt={status.fiveHourResetsAt} />
				<LimitRow label="WOCHE (7 TAGE)" percent={status.sevenDayPercent} resetsAt={status.sevenDayResetsAt} />
				<div className="aos-tok-note mono">Prozent vom Limit deines Plans, über alle Sessions</div>
			</div>
		</ModalFrame>
	);
}

function openExternal(url: string): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const el = require("electron");
		if (el?.shell?.openExternal !== undefined) { void el.shell.openExternal(url); return; }
	} catch (_) { /* not in electron */ }
	window.open(url, "_blank");
}

export function PlanModal({ plan, onClose }: { plan: PlanInfo | null; onClose: () => void }): JSX.Element {
	const since = plan !== null && plan.since ? new Date(plan.since) : null;
	return (
		<ModalFrame
			title="ABO-PLAN"
			className="aos-tok"
			onClose={onClose}
			footer={
				<button className="aos-modal-close mono aos-cv-btn" title="claude.ai/settings/billing im Browser öffnen" onClick={() => openExternal("https://claude.ai/settings/billing")}>
					PLAN VERWALTEN ↗
				</button>
			}
		>
			<div className="aos-tok-body">
				{plan === null ? (
					<div className="aos-tok-reset mono">Wird gelesen …</div>
				) : plan.err !== undefined ? (
					<div className="aos-plan-err mono">{plan.err}</div>
				) : (
					<>
						<div className={"aos-plan-name mono plan-" + (plan.cls ?? "other")}>{plan.label}</div>
						<Row label="STUFE" value={plan.stufe ?? ""} />
						<Row label="KONTO" value={plan.email ?? ""} />
						<Row label="ABO SEIT" value={since !== null && !isNaN(since.getTime()) ? since.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""} />
						<Row label="ABRECHNUNG" value={plan.billing ?? ""} />
						<Row label="EXTRA USAGE" value={plan.extra === true ? "aktiv" : "aus"} />
						<Row label="ORG-TYP" value={plan.type ?? ""} />
						<Row label="RATE-LIMIT-TIER" value={plan.tier ?? ""} />
						<div className="aos-tok-note mono">Quelle: ~/.claude.json (oauthAccount)</div>
					</>
				)}
			</div>
		</ModalFrame>
	);
}

type UpdatePhase = "idle" | "run" | "ok" | "fail";

export function ClaudeVersionModal({ current, onClose }: { current?: string; onClose: () => void }): JSX.Element {
	const [latest, setLatest] = useState<string | null>(cachedLatestVersion());
	const [phase, setPhase] = useState<UpdatePhase>("idle");
	const [out, setOut] = useState<string>("");
	const alive = useRef<boolean>(true);

	useEffect(() => {
		alive.current = true;
		void latestClaudeVersion(true).then((v) => { if (alive.current) setLatest(v); });
		return () => { alive.current = false; };
	}, []);

	const needsUpdate = latest !== null && current !== undefined && compareVersions(latest, current) > 0;
	const append = (d: unknown): void => { if (alive.current) setOut((o) => o + String(d)); };

	const runUpdate = (): void => {
		if (!needsUpdate || phase !== "idle") return;
		setPhase("run");
		setOut("");
		let p: ReturnType<typeof spawn>;
		try {
			p = spawn(claudeBinary(), ["update"], { env: spawnEnv(), windowsHide: true });
		} catch (e) {
			setOut(String(e));
			setPhase("fail");
			return;
		}
		const timer = setTimeout(() => { try { p.kill(); } catch (_) { /* gone */ } }, 300_000);
		p.stdout?.on("data", append);
		p.stderr?.on("data", append);
		p.on("error", append);
		p.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) { append("\nFertig. Gilt für neu geöffnete Code-Tabs."); if (alive.current) setPhase("ok"); }
			else { append(`\nExit-Code ${String(code)}`); if (alive.current) setPhase("fail"); }
		});
	};

	const label = phase === "run" ? "UPDATE LÄUFT …" : phase === "ok" ? "INSTALLIERT" : phase === "fail" ? "FEHLGESCHLAGEN" : needsUpdate ? `AUF ${latest ?? ""} UPDATEN` : "AKTUELL";
	return (
		<ModalFrame
			title="CLAUDE CODE"
			className="aos-tok"
			onClose={onClose}
			footer={<button className="aos-modal-close mono aos-cv-btn" disabled={!needsUpdate || phase !== "idle"} onClick={runUpdate}>{label}</button>}
		>
			<div className="aos-tok-body">
				<div className={"aos-plan-name mono aos-cv-" + (needsUpdate ? "upd" : "ok")}>{current ?? "?"}</div>
				<Row label="LÄUFT IN DIESEM TAB" value={current ?? "?"} />
				<Row label="NEUESTE VERSION" value={latest ?? "unbekannt (Prüfung fehlgeschlagen)"} />
				<Row label="STATUS" value={latest === null || current === undefined ? "" : needsUpdate ? "Update verfügbar" : "aktuell"} />
				{out.length > 0 && <pre className="aos-cv-out mono">{out}</pre>}
				<div className="aos-tok-note mono">Quelle: registry.npmjs.org (@anthropic-ai/claude-code)</div>
			</div>
		</ModalFrame>
	);
}

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import {
	cachedLatestVersion, compareVersions, latestClaudeVersion, limitPercent, readPlan, readSidecar,
	type CodeStatus, type PlanInfo,
} from "./claudeInfo";
import { GitPanel, gitRun, gitStatus, gitSync, type GitStatus } from "./git";
import { ClaudeVersionModal, LimitsModal, PlanModal } from "./StatusModals";

interface Props {
	/** status parsed from the TUI */
	parsed: CodeStatus;
	sessionName: string;
	gitCwd: string;
	dangerous: boolean;
	onOpenModel: () => void;
	onOpenEffort: () => void;
	onOpenPermissions: () => void;
	onOpenContext: () => void;
	onOpenHelp: () => void;
	onOpenPlugins: () => void;
	/** merged status (TUI + sidecar) for the modals of the pane */
	onStatus: (s: CodeStatus) => void;
}

const EFFORTS = /^(none|minimal|medium|high|xhigh|max)$/;

function shortModel(model?: string): string {
	if (model === undefined) return "?";
	for (const n of ["Fable", "Opus", "Sonnet", "Haiku"]) if (new RegExp(n, "i").test(model)) return n;
	return model.slice(0, 8);
}

function modeColor(mode?: string): string {
	if (mode === "auto") return "var(--green)";
	if (mode === "plan") return "var(--c-fbbf24)";
	if (mode === "bypass" || mode === "yolo") return "var(--red)";
	return "var(--c-88aaaa)";
}

function levelColor(pct?: number): string {
	if (pct === undefined) return "var(--dim)";
	if (pct >= 60) return "var(--effort-max)";
	if (pct > 50) return "var(--effort-high)";
	if (pct > 40) return "var(--effort-medium)";
	return "var(--green)";
}

function gitClass(g: GitStatus | null): string {
	if (g === null || !g.repo) return "";
	if ((g.behind ?? 0) > 0) return " sync-behind";
	if ((g.dirty ?? 0) > 0) return " sync-dirty";
	if ((g.ahead ?? 0) > 0) return " sync-ahead";
	return g.up === true ? " sync-ok" : "";
}

function gitLabel(g: GitStatus | null): string {
	if (g === null) return "…";
	if (!g.repo) return "kein Repo";
	const a = g.ahead ?? 0, b = g.behind ?? 0, d = g.dirty ?? 0;
	return (g.branch ?? "") + (a > 0 ? ` ↑${a}` : "") + (b > 0 ? ` ↓${b}` : "") + (d > 0 ? ` ●${d}` : "") + (g.up === true && a === 0 && b === 0 && d === 0 ? " ✓" : "");
}

const GIT_ICON = "M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187";

export function CodeStatusBar(p: Props): JSX.Element {
	const [sidecar, setSidecar] = useState<Partial<CodeStatus> | undefined>(undefined);
	const [plan, setPlan] = useState<PlanInfo | null>(null);
	const [git, setGit] = useState<GitStatus | null>(null);
	const [gitBusy, setGitBusy] = useState<boolean>(false);
	const [gitTick, setGitTick] = useState<number>(0);
	const [latest, setLatest] = useState<string | null>(cachedLatestVersion());
	const [showLimits, setShowLimits] = useState<boolean>(false);
	const [showPlan, setShowPlan] = useState<boolean>(false);
	const [showVersion, setShowVersion] = useState<boolean>(false);

	// Plan: once a minute (changes rarely).
	useEffect(() => {
		const rd = (): void => setPlan(readPlan());
		rd();
		const iv = window.setInterval(rd, 60_000);
		return () => window.clearInterval(iv);
	}, []);

	// Git status every 5 s.
	useEffect(() => {
		let alive = true;
		const rd = async (): Promise<void> => {
			const g = await gitStatus(p.gitCwd);
			if (alive) setGit(g);
		};
		void rd();
		const iv = window.setInterval(() => { void rd(); }, 5000);
		return () => { alive = false; window.clearInterval(iv); };
	}, [p.gitCwd, gitTick]);

	// Latest Claude Code version, hourly (cached 6 h).
	useEffect(() => {
		let alive = true;
		const ck = (): void => { void latestClaudeVersion(false).then((v) => { if (alive) setLatest(v); }); };
		ck();
		const iv = window.setInterval(ck, 3_600_000);
		return () => { alive = false; window.clearInterval(iv); };
	}, []);

	// Statusline sidecar every second.
	useEffect(() => {
		const rd = (): void => setSidecar(readSidecar(p.sessionName));
		rd();
		const iv = window.setInterval(rd, 1000);
		return () => window.clearInterval(iv);
	}, [p.sessionName]);

	const s: CodeStatus = { ...p.parsed };
	if (sidecar !== undefined) {
		for (const [k, v] of Object.entries(sidecar)) {
			if (v !== undefined) (s as Record<string, unknown>)[k] = v;
		}
	}
	if (s.permissionMode === undefined) s.permissionMode = p.dangerous ? "bypass" : "default";

	const { onStatus } = p;
	const statusKey = JSON.stringify(s);
	useEffect(() => { onStatus(s); }, [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps

	const ctx = s.contextPercent;
	const t5 = limitPercent(s.fiveHourPercent, s.fiveHourResetsAt);
	const t7 = limitPercent(s.sevenDayPercent, s.sevenDayResetsAt);
	const tMax = t5 === undefined ? t7 : t7 === undefined ? t5 : Math.max(t5, t7);
	const update = latest !== null && s.version !== undefined && compareVersions(latest, s.version) > 0;

	const runSync = useCallback((): void => {
		if (gitBusy) return;
		setGitBusy(true);
		void gitSync(p.gitCwd, p.sessionName).finally(() => setGitBusy(false));
	}, [gitBusy, p.gitCwd, p.sessionName]);

	const openGit = (): void => {
		if (gitBusy) return;
		if (git !== null && !git.repo) { runSync(); return; }
		setGitBusy(true);
		void gitRun(p.gitCwd, ["fetch", "--quiet"]).then((r) => {
			setGitTick((k) => k + 1);
			new GitPanel(p.gitCwd, runSync, r.code !== 0 ? r : null).open();
		}).finally(() => setGitBusy(false));
	};

	return (
		<div className="status-bar">
			{showLimits && <LimitsModal status={s} onClose={() => setShowLimits(false)} />}
			{showPlan && <PlanModal plan={plan} onClose={() => setShowPlan(false)} />}
			{showVersion && <ClaudeVersionModal current={s.version} onClose={() => setShowVersion(false)} />}
			<button
				className={"status-pill plan plan-" + (plan === null || plan.err !== undefined ? "other" : plan.cls ?? "other") + (plan?.err !== undefined ? " plan-err" : "")}
				onClick={() => setShowPlan(true)}
				title={plan?.err ?? "Abo-Plan · Details"}
			>
				<span className="status-pill-label">PLAN</span>
				<span className="status-pill-value">{plan === null ? "…" : plan.err !== undefined ? "!" : plan.label}</span>
			</button>
			<button className="status-pill model" onClick={p.onOpenModel} title="Modell wechseln">
				<span className="status-pill-label">MODEL</span>
				<span className="status-pill-value">{shortModel(s.model)}</span>
			</button>
			<button
				className="status-pill mode"
				onClick={p.onOpenPermissions}
				title="Permission-Modus wechseln"
				style={{ ["--mode-color" as string]: modeColor(s.permissionMode) }}
			>
				<span className="status-pill-label">MODE</span>
				<span className="status-pill-value">{s.permissionMode ?? "?"}</span>
			</button>
			<button
				className={"status-pill effort" + (s.effort !== undefined && EFFORTS.test(s.effort) ? " effort-" + s.effort : "")}
				onClick={p.onOpenEffort}
				title="Thinking-Effort umstellen"
			>
				<span className="status-pill-label">EFFORT</span>
				<span className="status-pill-value">{s.effort ?? "?"}</span>
			</button>
			<button
				className={"status-pill context" + (ctx !== undefined && ctx >= 70 ? " handoff-hint" : "")}
				onClick={p.onOpenContext}
				title={ctx !== undefined && ctx >= 70 ? "Context-Window, Handoff empfohlen" : "Context-Window und Session-Handoff"}
				style={{ ["--ctx-color" as string]: levelColor(ctx) }}
			>
				<span className="status-pill-label">CTX</span>
				<span className="status-pill-value">{ctx !== undefined ? `${ctx}%` : "—"}</span>
				<span className="status-ctx-bar">
					<span className="status-ctx-fill" style={{ width: ctx !== undefined ? `${Math.min(ctx, 100)}%` : "0%" }} />
				</span>
			</button>
			<button
				className="status-pill context tokens"
				onClick={() => setShowLimits(true)}
				title="Plan-Nutzung: 5h-Fenster · Woche (Balken = höherer Wert)"
				style={{ ["--ctx-color" as string]: levelColor(tMax) }}
			>
				<span className="status-pill-label">TOK</span>
				<span className="status-pill-value">{`5h ${t5 !== undefined ? t5 + "%" : "—"} · W ${t7 !== undefined ? t7 + "%" : "—"}`}</span>
				<span className="status-ctx-bar">
					<span className="status-ctx-fill" style={{ width: tMax !== undefined ? `${Math.min(tMax, 100)}%` : "0%" }} />
				</span>
			</button>
			{s.timeRemaining !== undefined && (
				<div className="status-pill workspace" title="Verbleibende Zeit (Limit)">
					<span className="status-pill-label">TIME</span>
					<span className="status-pill-value">{s.timeRemaining}</span>
				</div>
			)}
			<button
				className={"status-pill claude" + (update ? " has-update" : "")}
				onClick={() => setShowVersion(true)}
				title={update ? `Update verfügbar: ${latest ?? ""}` : "Claude-Code-Version · Update prüfen"}
			>
				<span className="status-pill-label">CLAUDE</span>
				<span className="status-pill-value">{s.version ?? "?"}</span>
				{update && <span className="status-pill-dot" />}
			</button>
			<button
				className={"status-pill action git" + gitClass(git)}
				disabled={gitBusy}
				onClick={openGit}
				title={gitBusy ? "Git-Prüfung läuft …" : "Git: Remote abgleichen (fetch), Branches, letzte Commits, Sync"}
			>
				<svg className="status-git-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={GIT_ICON} /></svg>
				<span className="status-pill-value">{gitLabel(git)}</span>
			</button>
			<button className="status-pill action" onClick={p.onOpenPlugins} title="Plugin- & Skill-Marketplace öffnen">
				<span className="status-pill-label">PLUGINS</span>
				<span className="status-pill-value">↗</span>
			</button>
			<button className="status-pill action" onClick={p.onOpenHelp} title="Alle Commands listen">
				<span className="status-pill-label">HELP</span>
				<span className="status-pill-value">?</span>
			</button>
		</div>
	);
}

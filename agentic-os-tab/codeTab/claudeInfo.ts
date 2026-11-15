import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { requestUrl } from "obsidian";
import type { StatusInfo } from "../ptySession";

/** Status of the tab: parsed from the TUI plus the values the statusline sidecar writes. */
export interface CodeStatus extends StatusInfo {
	version?: string;
	timeRemaining?: string;
	fiveHourPercent?: number;
	fiveHourResetsAt?: number;
	sevenDayPercent?: number;
	sevenDayResetsAt?: number;
}

export const STATUSLINE_DIR = join(homedir(), ".agentic-os", "statusline");

export function sidecarPath(sessionName: string): string {
	return join(STATUSLINE_DIR, sessionName.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Reads the sidecar JSON. undefined = no file yet (statusline not configured or no answer yet). */
export function readSidecar(sessionName: string): Partial<CodeStatus> | undefined {
	let raw: string;
	try { raw = readFileSync(sidecarPath(sessionName), "utf-8"); } catch (_) { return undefined; }
	try {
		const j = JSON.parse(raw) as Record<string, unknown>;
		const mode = str(j.permissionMode);
		const ctx = num(j.contextPercent);
		return {
			model: str(j.model),
			effort: str(j.effort),
			permissionMode: mode === "bypassPermissions" ? "bypass" : mode,
			contextPercent: ctx !== undefined ? Math.round(ctx) : undefined,
			version: str(j.version),
			timeRemaining: str(j.timeRemaining),
			fiveHourPercent: num(j.fiveHourPercent),
			fiveHourResetsAt: num(j.fiveHourResetsAt),
			sevenDayPercent: num(j.sevenDayPercent),
			sevenDayResetsAt: num(j.sevenDayResetsAt),
		};
	} catch (e) {
		console.warn("[agentic-os-code-tab] statusline json invalid:", e);
		return undefined;
	}
}

/** Percent of a rate limit, undefined if unknown or the window already reset. */
export function limitPercent(p?: number, resetsAt?: number): number | undefined {
	if (p === undefined) return undefined;
	if (resetsAt !== undefined && resetsAt * 1000 <= Date.now()) return undefined;
	return Math.round(p);
}

export function formatReset(sec: number): string {
	const d = new Date(sec * 1000);
	const m = Math.max(0, Math.round((d.getTime() - Date.now()) / 60_000));
	const h = Math.floor(m / 60);
	const days = Math.floor(h / 24);
	const rel = days > 0 ? `${days} d ${h % 24} h` : h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
	return d.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + ` (in ${rel})`;
}

export interface PlanInfo {
	err?: string;
	label?: string;
	/** css modifier: pro | max | ultra | team | other */
	cls?: string;
	stufe?: string;
	type?: string;
	tier?: string;
	billing?: string;
	extra?: boolean;
	email?: string;
	since?: string;
}

/** Subscription info from ~/.claude.json (oauthAccount). Read-only, stays local. */
export function readPlan(): PlanInfo {
	let a: unknown;
	try {
		a = (JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8")) as { oauthAccount?: unknown }).oauthAccount;
	} catch (e) {
		return { err: "~/.claude.json nicht lesbar: " + String(e) };
	}
	if (a === null || typeof a !== "object") return { err: "Kein oauthAccount in ~/.claude.json, nicht mit einem Claude-Abo eingeloggt?" };
	const o = a as Record<string, unknown>;
	const s = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
	const plan = s("planDisplayName");
	if (plan.length === 0) return { err: "planDisplayName fehlt in ~/.claude.json, Claude Code einmal neu starten" };
	let stufe = s("seatTier");
	stufe = stufe.length > 0 ? stufe.charAt(0).toUpperCase() + stufe.slice(1).toLowerCase() : "";
	const label = stufe.length > 0 && !plan.toLowerCase().includes(stufe.toLowerCase()) ? `${plan} ${stufe}` : plan;
	let cls = (plan.split(/\s+/)[0] ?? "").toLowerCase();
	if (!["pro", "max", "ultra", "team"].includes(cls)) cls = "other";
	return {
		label, cls, stufe,
		type: s("organizationType"),
		tier: s("userRateLimitTier") || s("organizationRateLimitTier"),
		billing: s("billingType"),
		extra: o.hasExtraUsageEnabled === true,
		email: s("emailAddress"),
		since: s("subscriptionCreatedAt"),
	};
}

export function compareVersions(a: string, b: string): number {
	const x = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
	const y = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

const latest: { v: string | null; t: number; p: Promise<string | null> | null } = { v: null, t: 0, p: null };

export function cachedLatestVersion(): string | null {
	return latest.v;
}

/** Latest Claude Code version from the npm registry, cached 6 h. null = check failed. */
export function latestClaudeVersion(force: boolean): Promise<string | null> {
	if (!force && latest.v !== null && Date.now() - latest.t < 6 * 3_600_000) return Promise.resolve(latest.v);
	if (latest.p !== null) return latest.p;
	latest.p = (async () => {
		try {
			const r = await requestUrl({ url: "https://registry.npmjs.org/@anthropic-ai/claude-code/latest", throw: false });
			const v = (r.json as { version?: unknown } | null)?.version;
			if (r.status === 200 && typeof v === "string") { latest.v = v; latest.t = Date.now(); }
			else console.warn("[agentic-os-code-tab] claude version check failed: HTTP " + r.status);
		} catch (e) {
			console.warn("[agentic-os-code-tab] claude version check failed:", e);
		}
		latest.p = null;
		return latest.v;
	})();
	return latest.p;
}

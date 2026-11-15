import * as React from "react";
import { useEffect, useState } from "react";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ask } from "./ui";

/**
 * Session handoff: writes / loads <cwd>/Handoff/HANDOFF.<name>.md via the
 * Claude Code plugin "session-handoff" (third party, from the Claude plugin directory).
 */

const SKILL_REPO = "github.com/mehmeteminduran/claude-session-handoff-plugin";

interface HandoffFile { name: string; path: string; mtime: number }

/** true if a plugin "session-handoff@<marketplace>" is installed for this user. */
export function handoffSkillInstalled(): boolean {
	try {
		const f = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "plugins", "installed_plugins.json");
		const d = JSON.parse(readFileSync(f, "utf-8")) as { plugins?: Record<string, unknown> };
		return Object.keys(d.plugins ?? {}).some((k) => k.startsWith("session-handoff@"));
	} catch (_) {
		return false;
	}
}

function listHandoffs(cwd: string): HandoffFile[] {
	const dir = join(cwd, "Handoff");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /\.md$/i.test(f))
		.map((f) => {
			const p = join(dir, f);
			return { name: f, path: p, mtime: statSync(p).mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime);
}

/** In git repos, Handoff/ goes into .gitignore (handoffs are session notes, not code). */
function ignoreHandoffDir(cwd: string): void {
	if (!existsSync(join(cwd, ".git"))) return;
	const gi = join(cwd, ".gitignore");
	const text = existsSync(gi) ? readFileSync(gi, "utf-8") : "";
	if (text.split(/\r?\n/).some((l) => /^\/?Handoff\/?$/.test(l.trim()))) return;
	writeFileSync(gi, text + (text.length > 0 && !text.endsWith("\n") ? "\n" : "") + "Handoff/\n", "utf-8");
}

function slug(name: string): string {
	const s = name.trim().toLowerCase().replace(/[\s/]+/g, "-").replace(/[^a-z0-9._-]/g, "");
	if (s.length > 0) return s;
	const d = new Date();
	const p = (v: number): string => String(v).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

interface Props {
	cwd: string;
	/** sends a prompt to claude in this tab */
	onSend: (prompt: string) => void;
	/** /clear, then sends the prompt */
	onLoad: (prompt: string) => void;
}

export function HandoffSection({ cwd, onSend, onLoad }: Props): JSX.Element {
	const [name, setName] = useState<string>("");
	const [err, setErr] = useState<string | null>(null);
	const [files, setFiles] = useState<HandoffFile[]>([]);
	const dir = join(cwd, "Handoff");

	useEffect(() => {
		try {
			setFiles(listHandoffs(cwd));
		} catch (e) {
			setErr("Handoff-Ordner nicht lesbar: " + (e instanceof Error ? e.message : String(e)));
		}
	}, [cwd]);

	/** Without the skill: offer installing it (claude in this tab does the install). */
	const ensureSkill = async (): Promise<boolean> => {
		if (handoffSkillInstalled()) return true;
		const yes = await ask(
			"Skill „session-handoff“ fehlt",
			`Für Handoffs braucht Claude Code das Plugin „session-handoff“ (Drittanbieter, ${SKILL_REPO}, aus dem Claude-Plugin-Verzeichnis). Soll Claude es jetzt in diesem Tab installieren? Danach den Tab einmal neu starten (/clear).`,
			"Installieren",
		);
		if (yes) {
			onSend(`Install the Claude Code plugin "session-handoff" from ${SKILL_REPO} for my user (add its marketplace if needed, then install the plugin). Show me each command before you run it. When done, tell me to restart this tab with /clear.`);
		}
		return false;
	};

	const create = async (): Promise<void> => {
		if (!await ensureSkill()) return;
		const s = slug(name);
		const file = join(dir, `HANDOFF.${s}.md`);
		try {
			ignoreHandoffDir(cwd);
		} catch (e) {
			setErr(".gitignore nicht beschreibbar: " + (e instanceof Error ? e.message : String(e)));
			return;
		}
		onSend(`Run the session-handoff:handoff skill with session name "${s}", but write the handoff file to ${file} instead of the repo root (create the Handoff folder if missing).`);
	};

	const load = async (f: HandoffFile): Promise<void> => {
		if (!await ensureSkill()) return;
		onLoad(`Run the session-handoff:resume skill, but read the handoff file at ${f.path} instead of the repo root.`);
	};

	return (
		<div className="aos-ho">
			<div className="aos-ho-h mono small-caps">SESSION-HANDOFF</div>
			{err !== null && <div className="aos-ho-err mono">{err}</div>}
			<div className="aos-ho-row">
				<input
					className="aos-ho-input mono"
					type="text"
					aria-label="Handoff-Name (optional)"
					placeholder="Name (optional)"
					maxLength={60}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }}
				/>
				<button className="aos-ho-btn mono" onClick={() => { void create(); }} title={"Handoff in " + dir + " schreiben"}>HANDOFF ERSTELLEN</button>
			</div>
			{files.length === 0 ? (
				<div className="aos-ho-empty mono">{"Noch kein Handoff in " + dir}</div>
			) : (
				<div className="aos-ho-list">
					{files.map((f) => (
						<button key={f.path} className="aos-ho-item mono" title="Context leeren (/clear) und diesen Handoff laden" onClick={() => { void load(f); }}>
							<span className="aos-ho-name">{f.name}</span>
							<span className="aos-ho-age">{new Date(f.mtime).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

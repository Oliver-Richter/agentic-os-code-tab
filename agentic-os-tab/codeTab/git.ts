import { spawn } from "child_process";
import { Modal, Notice } from "obsidian";
import { resolveBinary, spawnEnv, isWin } from "../platform";
import { sendText } from "./session";
import { ask } from "./ui";

export interface GitResult { code: number; out: string }

export interface GitStatus {
	repo: boolean;
	branch?: string;
	ahead?: number;
	behind?: number;
	dirty?: number;
	/** true if the branch has an upstream */
	up?: boolean;
}

/** Runs git with argv (no shell). 60 s timeout. Never rejects. */
export function gitRun(cwd: string, args: string[]): Promise<GitResult> {
	return new Promise((resolve) => {
		const bin = resolveBinary("git") ?? (isWin ? "git.exe" : "git");
		let out = "";
		let p: ReturnType<typeof spawn>;
		try {
			p = spawn(bin, args, { cwd, env: spawnEnv(), windowsHide: true });
		} catch (e) {
			resolve({ code: -1, out: String(e) });
			return;
		}
		const timer = setTimeout(() => { try { p.kill(); } catch (_) { /* gone */ } }, 60_000);
		p.stdout?.on("data", (d) => { out += String(d); });
		p.stderr?.on("data", (d) => { out += String(d); });
		p.on("error", (e) => { out += String(e); });
		p.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, out: out.trim() });
		});
	});
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
	const r = await gitRun(cwd, ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
	if (r.code !== 0) return { repo: false };
	let branch = "";
	let ahead: number | null = null;
	let behind = 0;
	let dirty = 0;
	for (const line of r.out.split("\n")) {
		if (line.length > 0 && !line.startsWith("#")) dirty++;
		if (line.startsWith("# branch.head ")) branch = line.slice(14);
		const m = line.match(/^# branch\.ab \+(\d+) -(\d+)/);
		if (m !== null) { ahead = parseInt(m[1] ?? "0", 10); behind = parseInt(m[2] ?? "0", 10); }
	}
	const up = ahead !== null;
	if (ahead === null) {
		const x = await gitRun(cwd, ["rev-list", "--count", "HEAD", "--not", "--remotes"]);
		ahead = x.code === 0 ? (parseInt(x.out, 10) || 0) : 0;
	}
	return { repo: true, branch: branch === "(detached)" ? "detached" : branch, ahead, behind, dirty, up };
}

function notice(msg: string, r?: GitResult, ms = 10_000): void {
	new Notice(`Git: ${msg}${r !== undefined && r.out.length > 0 ? "\n" + r.out.slice(-400) : ""}`, ms);
}

/**
 * Commit (and push if a remote exists) by asking claude in the tab: claude writes the message.
 * Without changes but with unpushed commits it pushes directly.
 */
export async function gitSync(cwd: string, sessionName: string): Promise<void> {
	try {
		let r = await gitRun(cwd, ["--version"]);
		if (r.code !== 0) { notice("git ist nicht installiert bzw. nicht im PATH.", r); return; }
		r = await gitRun(cwd, ["rev-parse", "--is-inside-work-tree"]);
		if (r.code !== 0) {
			if (!await ask("Kein Git-Repository", `Im Ordner ${cwd} gibt es kein Git-Repository. Jetzt lokal anlegen (git init)?`, "Repository anlegen")) return;
			r = await gitRun(cwd, ["init"]);
			if (r.code !== 0) { notice("init fehlgeschlagen", r); return; }
		}
		r = await gitRun(cwd, ["status", "--porcelain"]);
		if (r.code !== 0) { notice("status fehlgeschlagen", r); return; }
		if (r.out.length === 0) {
			const us = await gitRun(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
			if (us.code !== 0) { new Notice("Git: keine Änderungen.", 4000); return; }
			const ah = await gitRun(cwd, ["rev-list", "--count", "@{upstream}..HEAD"]);
			if (ah.code !== 0) { notice("Abgleich mit Upstream fehlgeschlagen", ah); return; }
			const n = parseInt(ah.out, 10);
			if (!(n > 0)) { new Notice(`Git: keine Änderungen, in Sync mit ${us.out}.`, 4000); return; }
			const ps = await gitRun(cwd, ["push"]);
			if (ps.code === 0) new Notice(`Git: ${n} Commit(s) nach ${us.out} gepusht.`, 5000);
			else notice("Push fehlgeschlagen", ps);
			return;
		}
		const rm = await gitRun(cwd, ["remote"]);
		const hasRemote = rm.code === 0 && rm.out.length > 0;
		if (!hasRemote && !await ask("Kein Remote-Repository", `Für ${cwd} ist kein Remote konfiguriert, Push ist nicht möglich. Nur lokal committen?`, "Lokal committen")) return;
		const msg = hasRemote ? "commit und push" : "commit";
		const sent = sendText(sessionName, msg);
		if (sent.ok) new Notice(`Git: „${msg}“ an Claude gesendet.`, 3000);
		else new Notice(`Git: Senden an Claude fehlgeschlagen: ${sent.error ?? "Terminal läuft nicht"}`, 6000);
	} catch (e) {
		notice(`Fehler ${String(e)}`);
	}
}

/** Git panel: sync state, pull (ff-only), switch branch, last 5 commits with diff/revert/reset. */
export class GitPanel extends Modal {
	private msgEl!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(private cwd: string, private onSync: () => void, private fetchError: GitResult | null) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		super((window as any).app);
	}

	onOpen(): void {
		this.modalEl.addClass("aos-gm");
		this.titleEl.setText("Git");
		this.msgEl = this.contentEl.createDiv({ cls: "aos-gm-msg" });
		this.msgEl.hide();
		this.bodyEl = this.contentEl.createDiv();
		this.modalEl.createDiv({ cls: "aos-gm-foot" })
			.createEl("button", { cls: "aos-gm-close", text: "SCHLIEßEN" })
			.addEventListener("click", () => this.close());
		void this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private say(m: string, bad: boolean, r?: GitResult): void {
		this.msgEl.removeClass("aos-gm-err", "aos-gm-ok");
		this.msgEl.addClass(bad ? "aos-gm-err" : "aos-gm-ok");
		this.msgEl.setText(m + (r !== undefined && r.out.length > 0 ? "\n" + r.out.slice(-600) : ""));
		this.msgEl.show();
	}

	/** null = status failed (message shown) */
	private async dirty(): Promise<boolean | null> {
		const r = await gitRun(this.cwd, ["status", "--porcelain"]);
		if (r.code !== 0) { this.say("git status fehlgeschlagen", true, r); return null; }
		return r.out.length > 0;
	}

	private section(title: string): HTMLElement {
		const d = this.bodyEl.createDiv({ cls: "aos-gm-sec" });
		d.createDiv({ cls: "aos-gm-h", text: title });
		return d;
	}

	private async render(): Promise<void> {
		const c = this.cwd;
		const r = await gitRun(c, ["rev-parse", "--is-inside-work-tree"]);
		this.bodyEl.empty();
		if (r.code !== 0) {
			this.bodyEl.createDiv({ cls: "aos-gm-empty", text: `Kein Git-Repository in ${c}` });
			return;
		}
		const cur = (await gitRun(c, ["branch", "--show-current"])).out;
		this.titleEl.setText("Git — " + (cur.length > 0 ? cur : "detached HEAD"));

		const s1 = this.section("SYNC");
		if (this.fetchError !== null) {
			this.say("git fetch fehlgeschlagen, Remote-Stand nicht aktuell", true, this.fetchError);
			this.fetchError = null;
		}
		const un = await gitRun(c, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
		if (un.code !== 0) {
			s1.createDiv({ cls: "aos-gm-empty", text: "Kein Upstream-Branch gesetzt." });
		} else {
			const ab = await gitRun(c, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
			const [a, b] = ab.code === 0 ? ab.out.split(/\s+/).map((x) => parseInt(x, 10)) : [NaN, NaN];
			if (a === undefined || b === undefined || isNaN(a) || isNaN(b)) {
				this.say(`Abgleich mit ${un.out} fehlgeschlagen`, true, ab);
			} else {
				s1.createDiv({ cls: "aos-gm-row", text: a === 0 && b === 0 ? `In Sync mit ${un.out}.` : `Gegenüber ${un.out}: ${a} lokal voraus, ${b} remote voraus.` });
				if (b > 0) {
					s1.createDiv({ cls: "aos-gm-acts" }).createEl("button", { text: `Pull (ff-only) — ${b} Commit(s)` }).addEventListener("click", async () => {
						const x = await gitRun(c, ["pull", "--ff-only"]);
						if (x.code === 0) this.say("Pull erfolgreich.", false, x);
						else this.say("Pull fehlgeschlagen", true, x);
						void this.render();
					});
				}
			}
		}
		s1.createEl("button", { cls: "mod-cta", text: "Änderungen committen & pushen" }).addEventListener("click", () => {
			this.close();
			this.onSync();
		});

		const s2 = this.section("BRANCHES");
		const br = await gitRun(c, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
		if (br.code !== 0) {
			this.say("Branches lesen fehlgeschlagen", true, br);
		} else {
			for (const name of br.out.split("\n").filter((x) => x.length > 0)) {
				const row = s2.createDiv({ cls: "aos-gm-row" });
				row.createSpan({ cls: "aos-gm-name", text: name });
				if (name === cur) { row.createSpan({ cls: "aos-gm-tag", text: "aktiv" }); continue; }
				row.createEl("button", { text: "Wechseln" }).addEventListener("click", async () => {
					const d = await this.dirty();
					if (d === null) return;
					if (d) { this.say("Uncommittete Änderungen vorhanden, erst committen, dann Branch wechseln.", true); return; }
					const x = await gitRun(c, ["switch", name]);
					if (x.code === 0) this.say(`Gewechselt zu ${name}.`, false);
					else this.say("Branch-Wechsel fehlgeschlagen", true, x);
					void this.render();
				});
			}
		}

		const s3 = this.section("LETZTE COMMITS");
		const lg = await gitRun(c, ["log", "-5", "--format=%H%x1f%h%x1f%s%x1f%cr"]);
		if (lg.code !== 0) { s3.createDiv({ cls: "aos-gm-empty", text: "Noch keine Commits." }); return; }
		const up = await gitRun(c, ["rev-list", "HEAD", "--not", "--remotes"]);
		const unpushed = new Set(up.code === 0 ? up.out.split("\n").filter((x) => x.length > 0) : []);
		const commits = lg.out.split("\n").filter((x) => x.length > 0).map((l) => {
			const [H = "", h = "", s = "", age = ""] = l.split("\x1f");
			return { H, h, s, age };
		});
		commits.forEach((cm, i) => {
			const row = s3.createDiv({ cls: "aos-gm-commit" });
			const top = row.createDiv({ cls: "aos-gm-row" });
			top.createSpan({ cls: "aos-gm-hash", text: cm.h });
			top.createSpan({ cls: "aos-gm-subj", text: cm.s });
			top.createSpan({ cls: "aos-gm-age", text: (unpushed.has(cm.H) ? "lokal · " : "") + cm.age });
			const acts = row.createDiv({ cls: "aos-gm-acts" });
			const pre = row.createEl("pre", { cls: "aos-gm-out" });
			pre.hide();
			let open = false;
			acts.createEl("button", { text: "Hash kopieren" }).addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(cm.H);
					this.say(`Hash ${cm.h} kopiert.`, false);
				} catch (e) {
					this.say("Kopieren fehlgeschlagen: " + String(e), true);
				}
			});
			acts.createEl("button", { text: "Diff" }).addEventListener("click", async () => {
				if (open) { open = false; pre.hide(); return; }
				const x = await gitRun(c, ["show", "--stat", "--patch", "--format=%an, %cd%n%n%B", cm.H]);
				pre.setText(x.code === 0 ? x.out.slice(0, 40_000) : "Fehler: " + x.out);
				open = true;
				pre.show();
			});
			acts.createEl("button", { text: "Revert" }).addEventListener("click", async () => {
				const d = await this.dirty();
				if (d === null) return;
				if (d) { this.say("Uncommittete Änderungen vorhanden, erst committen, dann reverten.", true); return; }
				if (!await ask("Commit rückgängig machen", `Legt einen neuen Commit an, der ${cm.h} „${cm.s}“ rückgängig macht. Die History bleibt erhalten.`, `${cm.h} reverten`)) return;
				const x = await gitRun(c, ["revert", "--no-edit", cm.H]);
				if (x.code === 0) {
					this.say(`${cm.h} revertiert (neuer Commit, noch nicht gepusht).`, false);
				} else {
					await gitRun(c, ["revert", "--abort"]);
					this.say("Revert fehlgeschlagen und abgebrochen, Repository unverändert", true, x);
				}
				void this.render();
			});
			// Hard reset only if every newer commit is still local (never rewrites pushed history).
			if (i > 0 && commits.slice(0, i).every((z) => unpushed.has(z.H))) {
				acts.createEl("button", { cls: "mod-warning", text: "Zurücksetzen" }).addEventListener("click", async () => {
					const d = await this.dirty();
					if (d === null) return;
					if (d) { this.say("Uncommittete Änderungen vorhanden, Zurücksetzen würde sie löschen. Erst committen.", true); return; }
					if (!await ask("Hart zurücksetzen", `Setzt ${cur} auf ${cm.h} zurück. ${i} lokale(r), nicht gepushte(r) Commit(s) werden verworfen.`, `Auf ${cm.h} zurücksetzen`)) return;
					const x = await gitRun(c, ["reset", "--hard", cm.H]);
					if (x.code === 0) this.say(`Zurückgesetzt auf ${cm.h}.`, false);
					else this.say("Zurücksetzen fehlgeschlagen", true, x);
					void this.render();
				});
			}
		});
	}
}

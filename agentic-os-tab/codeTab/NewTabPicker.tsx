import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readdirSync, statSync } from "fs";
import { basename, dirname, join, parse as parsePath, sep } from "path";
import type { AgentDef } from "../loadAgents";
import type { ProjectEntry } from "../loadChatTabs";
import { getSettings } from "./settings";
import { useEscape } from "./StatusModals";

export interface PickResult {
	type: "claude" | "agent";
	agentName?: string;
	workspace: "home" | "vault";
	cwd?: string;
	displayName?: string;
	topic: string;
}

function TopicInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus: boolean }): JSX.Element {
	return (
		<input
			className="aos-topic-input mono"
			type="text"
			placeholder="Thema des Tabs (optional) — Titel: Ordner - Thema"
			value={value}
			maxLength={60}
			autoFocus={autoFocus}
			onClick={(e) => e.stopPropagation()}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

function listDirs(dir: string, hidden: boolean): { dirs: string[]; error: string | null } {
	try {
		const dirs = readdirSync(dir, { withFileTypes: true })
			.filter((d) => {
				if (!hidden && d.name.startsWith(".")) return false;
				if (d.isDirectory()) return true;
				if (!d.isSymbolicLink()) return false;
				try { return statSync(join(dir, d.name)).isDirectory(); } catch (_) { return false; }
			})
			.map((d) => d.name)
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
		return { dirs, error: null };
	} catch (e) {
		return { dirs: [], error: e instanceof Error ? e.message : String(e) };
	}
}

/** Folder browser: keyboard ↑/↓, Enter = into folder, Cmd/Ctrl+Enter = open tab here, Backspace = up. */
function FolderBrowser({ topic, onOpen, onCancel }: { topic: React.ReactNode; onOpen: (dir: string) => void; onCancel: () => void }): JSX.Element {
	const [dir, setDir] = useState<string>(() => getSettings().startDir);
	const [filter, setFilter] = useState<string>("");
	const [hidden, setHidden] = useState<boolean>(false);
	const [idx, setIdx] = useState<number>(0);
	const listRef = useRef<HTMLDivElement | null>(null);
	const listing = useMemo(() => listDirs(dir, hidden), [dir, hidden]);
	const shown = filter === "" ? listing.dirs : listing.dirs.filter((d) => d.toLowerCase().includes(filter.toLowerCase()));
	const parent = dirname(dir);
	const root = parsePath(dir).root;
	const segments = dir.slice(root.length).split(sep).filter((s) => s.length > 0);

	const go = (d: string): void => { setDir(d); setFilter(""); setIdx(0); };

	useEffect(() => {
		listRef.current?.children[idx]?.scrollIntoView({ block: "nearest" });
	}, [idx, dir]);

	const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(shown.length - 1, 0))); return; }
		if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); return; }
		if (e.key === "Enter") {
			e.preventDefault();
			if (e.metaKey || e.ctrlKey) { onOpen(dir); return; }
			const d = shown[idx];
			if (d !== undefined) go(join(dir, d));
			return;
		}
		if (e.key === "Backspace" && filter === "" && parent !== dir) { e.preventDefault(); go(parent); }
	};

	return (
		<div className="agent-picker aos-fb" onClick={(e) => e.stopPropagation()}>
			<div className="mono small-caps aos-fb-title">ORDNER WÄHLEN — neuer Code-Tab</div>
			{topic}
			<div className="aos-fb-crumbs mono">
				<button className="aos-fb-up" onClick={() => go(parent)} disabled={parent === dir} title="Eine Ebene hoch (Backspace)">↑</button>
				<button className="aos-fb-crumb" onClick={() => go(root)}>{root}</button>
				{segments.map((s, i) => (
					<button key={i} className="aos-fb-crumb aos-fb-seg" onClick={() => go(join(root, ...segments.slice(0, i + 1)))}>{s}</button>
				))}
			</div>
			<input className="aos-fb-filter mono" autoFocus spellCheck={false} placeholder="Ordner filtern…" value={filter} onChange={(e) => { setFilter(e.target.value); setIdx(0); }} onKeyDown={onKey} />
			<div className="aos-fb-list" ref={listRef}>
				{listing.error !== null ? (
					<div className="aos-fb-msg aos-fb-error mono">Ordner nicht lesbar: {listing.error}</div>
				) : shown.length === 0 ? (
					<div className="aos-fb-msg mono">{filter === "" ? "keine Unterordner" : "kein Treffer"}</div>
				) : shown.map((d, i) => (
					<button key={d} className={"picker-row aos-fb-row" + (i === idx ? " hovered" : "")} onClick={() => go(join(dir, d))} onMouseEnter={() => setIdx(i)}>
						<span className="dot aos-fb-dot" />
						<span className="mono aos-fb-name">{d}</span>
					</button>
				))}
			</div>
			<div className="aos-fb-footer">
				<label className="aos-fb-hidden mono">
					<input type="checkbox" checked={hidden} onChange={(e) => { setHidden(e.target.checked); setIdx(0); }} />
					versteckte Ordner
				</label>
				<button className="aos-fb-cancel mono" onClick={onCancel}>Abbrechen</button>
				<button className="aos-fb-open mono" onClick={() => onOpen(dir)} title="Cmd/Strg+Enter">Code-Tab hier öffnen</button>
			</div>
		</div>
	);
}

function PickRow({ dotClass, title, sub, onClick }: { dotClass: string; title: string; sub: string; onClick: () => void }): JSX.Element {
	return (
		<button className="picker-row" onClick={onClick}>
			<span className={"dot " + dotClass} />
			<div className="ct-pick-text">
				<span className="mono ct-pick-title">{title}</span>
				<span className="mono ct-pick-sub">{sub}</span>
			</div>
		</button>
	);
}

export function NewTabPicker({ agents, projects, onPick, onCancel }: {
	agents: AgentDef[];
	projects: ProjectEntry[];
	onPick: (r: PickResult) => void;
	onCancel: () => void;
}): JSX.Element {
	const [topic, setTopic] = useState<string>("");
	const [browse, setBrowse] = useState<boolean>(false);
	useEscape(onCancel);
	const pick = (r: Omit<PickResult, "topic">): void => onPick({ ...r, topic });
	const startDir = getSettings().startDir;

	if (browse) {
		return (
			<div className="agent-picker-overlay" onClick={onCancel}>
				<FolderBrowser
					topic={<TopicInput value={topic} onChange={setTopic} autoFocus={false} />}
					onOpen={(d) => pick({ type: "claude", workspace: "home", cwd: d, displayName: basename(d) || d })}
					onCancel={onCancel}
				/>
			</div>
		);
	}
	return (
		<div className="agent-picker-overlay" onClick={onCancel}>
			<div className="agent-picker" onClick={(e) => e.stopPropagation()}>
				<div className="mono small-caps ct-pick-head">NEUEN CODE-TAB STARTEN</div>
				<TopicInput value={topic} onChange={setTopic} autoFocus />
				<button className="picker-row" onClick={() => setBrowse(true)}>
					<span className="dot aos-fb-dot" />
					<div className="aos-fb-pick">
						<span className="mono aos-fb-pick-title">Ordner wählen…</span>
						<span className="mono aos-fb-pick-sub">Verzeichnis durchsuchen und als Arbeitsordner nutzen</span>
					</div>
				</button>
				<PickRow dotClass="ct-dot-accent" title="claude (neutral)" sub={`${startDir} als Arbeitsordner`} onClick={() => pick({ type: "claude", workspace: "home" })} />
				<PickRow dotClass="ct-dot-vault" title="claude (vault)" sub="Arbeitsordner = dein Obsidian-Vault" onClick={() => pick({ type: "claude", workspace: "vault" })} />
				{agents.map((a) => (
					<button key={a.name} className="picker-row" onClick={() => pick({ type: "agent", agentName: a.name, workspace: "vault" })}>
						<span className="dot" style={{ background: a.color ?? "var(--accent)" }} />
						<div className="ct-pick-text">
							<span className="mono ct-pick-title">{a.name}</span>
							<span className="mono ct-pick-sub">{a.description.slice(0, 80)}</span>
						</div>
					</button>
				))}
				{projects.length > 0 && <div className="mono small-caps ct-pick-group">PROJEKTE — claude im Projekt-Ordner</div>}
				{projects.map((p) => (
					<PickRow key={p.path} dotClass="ct-dot-green" title={p.name} sub={`cwd: ${p.path}`} onClick={() => pick({ type: "claude", workspace: "home", cwd: p.path, displayName: p.name })} />
				))}
			</div>
		</div>
	);
}

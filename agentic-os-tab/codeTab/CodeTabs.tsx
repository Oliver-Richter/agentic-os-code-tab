import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Menu, Notice } from "obsidian";
import { makeUUID, loadProjects, type ProjectEntry } from "../loadChatTabs";
import { loadAgents, type AgentDef } from "../loadAgents";
import { loadCommands, type SlashCommand } from "../loadCommands";
import { killSession } from "../ptySession";
import { CodePane } from "./CodePane";
import { NewTabPicker, type PickResult } from "./NewTabPicker";
import { codeSessionName, loadCodeTabs, MAX_TABS, saveCodeTabs, type CodeTab, type CodeTabsState } from "./tabsStore";
import { askText } from "./ui";

const DRAG_TYPE = "application/x-aos-code-tab";

/** Tab bar + active terminal of the Code view. */
export function CodeTabs(): JSX.Element {
	const [state, setState] = useState<CodeTabsState>(() => loadCodeTabs());
	const [picker, setPicker] = useState<boolean>(false);
	const [agents, setAgents] = useState<AgentDef[]>([]);
	const [projects, setProjects] = useState<ProjectEntry[]>([]);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [dragId, setDragId] = useState<string | null>(null);

	useEffect(() => {
		setAgents(loadAgents());
		setProjects(loadProjects());
		setCommands(loadCommands());
	}, []);

	useEffect(() => { saveCodeTabs(state); }, [state]);

	const addTab = (r: PickResult): void => {
		if (state.tabs.length >= MAX_TABS) { new Notice(`Maximal ${MAX_TABS} Code-Tabs.`); return; }
		const id = makeUUID();
		const base = r.displayName ?? r.agentName ?? (r.workspace === "vault" ? "claude (vault)" : "claude");
		const topic = r.topic.trim();
		const tab: CodeTab = { id, name: topic.length > 0 ? `${base} - ${topic}` : base, type: r.type, agentName: r.agentName, workspace: r.workspace, cwd: r.cwd };
		setState((prev) => ({ tabs: [...prev.tabs, tab], activeId: id }));
		setPicker(false);
	};

	const closeTab = useCallback((id: string): void => {
		setState((prev) => {
			const tab = prev.tabs.find((t) => t.id === id);
			if (tab !== undefined) killSession(codeSessionName(tab));
			const tabs = prev.tabs.filter((t) => t.id !== id);
			const activeId = prev.activeId === id ? (tabs[0]?.id ?? null) : prev.activeId;
			return { tabs, activeId };
		});
	}, []);

	const renameTab = async (tab: CodeTab): Promise<void> => {
		const name = await askText("Tab umbenennen", "Neuer Name", tab.name);
		if (name === null) return;
		setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === tab.id ? { ...t, name } : t)) }));
	};

	const patchActive = useCallback((patch: Partial<CodeTab>): void => {
		setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === prev.activeId ? { ...t, ...patch } : t)) }));
	}, []);

	const openMenu = (e: React.MouseEvent, tab: CodeTab): void => {
		e.preventDefault();
		const m = new Menu();
		m.addItem((i) => i.setTitle("Umbenennen").setIcon("pencil").onClick(() => { void renameTab(tab); }));
		if (state.tabs.length > 1) m.addItem((i) => i.setTitle("Schließen").setIcon("x").onClick(() => closeTab(tab.id)));
		m.showAtMouseEvent(e.nativeEvent);
	};

	const moveTab = (fromId: string, toId: string, after: boolean): void => {
		setState((prev) => {
			const tabs = prev.tabs.slice();
			const fi = tabs.findIndex((t) => t.id === fromId);
			if (fi < 0) return prev;
			const [moved] = tabs.splice(fi, 1);
			const ti = tabs.findIndex((t) => t.id === toId);
			if (moved === undefined || ti < 0) return prev;
			tabs.splice(after ? ti + 1 : ti, 0, moved);
			return { ...prev, tabs };
		});
	};

	const clearDropMarks = (): void => {
		document.querySelectorAll(".aos-drop-before,.aos-drop-after").forEach((el) => el.classList.remove("aos-drop-before", "aos-drop-after"));
	};

	const active = state.tabs.find((t) => t.id === state.activeId);

	return (
		<>
			<div className="chat-drawer chat-full">
				<div className="chat-drawer-tabs">
					{state.tabs.map((tab) => (
						<button
							key={tab.id}
							className={"chat-tab " + (tab.id === state.activeId ? "active" : "") + (tab.id === dragId ? " aos-dragging" : "")}
							onClick={() => setState((prev) => ({ ...prev, activeId: tab.id }))}
							onContextMenu={(e) => openMenu(e, tab)}
							draggable
							onDragStart={(e) => {
								setDragId(tab.id);
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData(DRAG_TYPE, tab.id);
							}}
							onDragOver={(e) => {
								if (dragId === null || dragId === tab.id) return;
								e.preventDefault();
								e.dataTransfer.dropEffect = "move";
								const box = e.currentTarget.getBoundingClientRect();
								const after = e.clientX > box.left + box.width / 2;
								e.currentTarget.classList.toggle("aos-drop-after", after);
								e.currentTarget.classList.toggle("aos-drop-before", !after);
							}}
							onDragLeave={(e) => e.currentTarget.classList.remove("aos-drop-before", "aos-drop-after")}
							onDrop={(e) => {
								const after = e.currentTarget.classList.contains("aos-drop-after");
								clearDropMarks();
								if (dragId === null || dragId === tab.id) return;
								e.preventDefault();
								moveTab(dragId, tab.id, after);
								setDragId(null);
							}}
							onDragEnd={() => { setDragId(null); clearDropMarks(); }}
							title="Ziehen: verschieben · Rechtsklick: umbenennen / schließen"
						>
							<span className="mono ct-tab-name">{tab.type === "agent" ? "◆ " : ""}{tab.name}</span>
							{state.tabs.length > 1 && (
								<span className="chat-tab-close" title="Schließen" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>×</span>
							)}
						</button>
					))}
					<button className="chat-tab-plus" onClick={() => setPicker(true)} title="Neuer Code-Tab" disabled={state.tabs.length >= MAX_TABS}>+</button>
				</div>
				{active !== undefined ? (
					<CodePane key={active.id} tab={active} commands={commands} onTabPatch={patchActive} />
				) : (
					<div className="ct-empty"><span className="mono small-caps">kein Tab offen · drück +</span></div>
				)}
			</div>
			{picker && <NewTabPicker agents={agents} projects={projects} onPick={addTab} onCancel={() => setPicker(false)} />}
		</>
	);
}

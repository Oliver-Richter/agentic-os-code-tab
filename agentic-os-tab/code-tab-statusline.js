#!/usr/bin/env node
/*
 * Statusline for Claude Code, used by the Agentic OS Code tab (Node, no dependencies).
 *
 * Inside a Code tab (env AGENTIC_OS_SESSION is set) it prints nothing and writes the
 * values for the status bar pills to ~/.agentic-os/statusline/<session>.json.
 * Elsewhere it prints a short status line, or with --danach "<command>" it runs your
 * previous statusline command with the same input and prints its output.
 *
 * ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "node \"<path>/code-tab-statusline.js\"" }
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function readStdin() {
	try { return fs.readFileSync(0, "utf-8"); } catch (_) { return ""; }
}

function pick(obj, keys) {
	for (const k of keys) {
		const v = k.split(".").reduce((o, p) => (o !== null && typeof o === "object" ? o[p] : undefined), obj);
		if (v !== undefined && v !== null && v !== "") return v;
	}
	return undefined;
}

function effortOf(input) {
	const e = pick(input, ["model.effort", "effort", "reasoning_effort", "model.effortLevel"]);
	if (e !== null && typeof e === "object") return pick(e, ["level", "name", "value"]);
	return e;
}

function num(v) {
	const n = typeof v === "number" ? v : parseFloat(v);
	return Number.isFinite(n) ? n : undefined;
}

const raw = readStdin();
let input = {};
try { input = JSON.parse(raw); } catch (_) { input = {}; }

const session = process.env.AGENTIC_OS_SESSION;
if (session !== undefined && session.length > 0) {
	const dir = path.join(os.homedir(), ".agentic-os", "statusline");
	const file = path.join(dir, session.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
	const rl = input.rate_limits || {};
	const time = pick(input, ["limits.time_remaining"]);
	const out = {
		model: pick(input, ["model.display_name", "model.id"]),
		effort: effortOf(input),
		permissionMode: pick(input, ["permission_mode", "permissionMode"]),
		contextPercent: num(pick(input, ["context_window.used_percentage"])),
		version: pick(input, ["version", "release_version", "app_version", "cli_version"]),
		timeRemaining: time === "unknown" ? undefined : time,
		fiveHourPercent: num(pick(rl, ["five_hour.used_percentage"])),
		fiveHourResetsAt: num(pick(rl, ["five_hour.resets_at"])),
		sevenDayPercent: num(pick(rl, ["seven_day.used_percentage"])),
		sevenDayResetsAt: num(pick(rl, ["seven_day.resets_at"])),
	};
	try {
		fs.mkdirSync(dir, { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(out));
		fs.renameSync(tmp, file);
	} catch (e) {
		process.stderr.write(`code-tab-statusline: ${e.message}\n`);
		process.exit(1);
	}
	process.exit(0);
}

const i = process.argv.indexOf("--danach");
if (i !== -1 && process.argv[i + 1] !== undefined) {
	const r = spawnSync(process.argv[i + 1], { input: raw, shell: true, encoding: "utf-8" });
	process.stdout.write(r.stdout || "");
	process.exit(r.status === null ? 1 : r.status);
}

const model = pick(input, ["model.display_name", "model.id"]) || "claude";
const ctx = num(pick(input, ["context_window.used_percentage"]));
process.stdout.write(model + (ctx !== undefined ? ` · ${Math.round(ctx)}%` : "") + "\n");

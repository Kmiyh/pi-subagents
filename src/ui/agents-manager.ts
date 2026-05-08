/**
 * Agents Manager — interactive TUI for browsing, previewing, and editing subagents
 */

import * as fs from "node:fs";
import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Editor,
	type Focusable,
	Input,
	Key,
	Markdown,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfig } from "../agents.js";
import {
	deleteAgentFile,
	isBundledAgent,
	isDeletableAgent,
	THINKING_LEVELS,
	writeAgentFile,
	writeBundledAgentOverrides,
} from "../agent-ops.js";

// ── Types ──────────────────────────────────────────────────────────────

type Mode = "browse" | "preview" | "edit-bundled" | "edit-full" | "delete-confirm";

// ── Utility ────────────────────────────────────────────────────────────

function scopeLabel(agent: AgentConfig): string {
	if (agent.source === "bundled") return "bundled";
	if (agent.source === "project") return "project";
	return "global";
}

function wrapLines(text: string, width: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= width) {
			current += " " + word;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

function buildFrontmatterString(agent: AgentConfig): string {
	const lines: string[] = ["---"];
	lines.push(`name: ${agent.name}`);
	lines.push(`description: ${agent.description}`);
	if (agent.model) lines.push(`model: ${agent.model}`);
	if (agent.thinking) lines.push(`thinking: ${agent.thinking}`);
	if (agent.tools && agent.tools.length > 0) lines.push(`tools: ${agent.tools.join(", ")}`);
	lines.push("---");
	return lines.join("\n");
}

// ── Scrollable Preview ─────────────────────────────────────────────────

class ScrollableAgentPreview {
	private scrollOffset = 0;

	constructor(
		private agent: AgentConfig,
		private theme: ExtensionContext["ui"]["theme"],
		private getRows: () => number,
	) {}

	setAgent(agent: AgentConfig): void {
		this.agent = agent;
		this.scrollOffset = 0;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 4);
		const maxContentHeight = Math.max(10, Math.floor(this.getRows() * 0.78)) - 3;
		const content = this.buildContent(innerWidth);
		const maxScroll = Math.max(0, content.length - maxContentHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

		const visible = content.slice(this.scrollOffset, this.scrollOffset + maxContentHeight);
		const top = this.theme.fg("accent", `┌${"─".repeat(innerWidth + 2)}┐`);
		const bottom = this.theme.fg("accent", `└${"─".repeat(innerWidth + 2)}┘`);
		const footer = this.buildFooter(innerWidth, maxContentHeight, content.length);

		return [
			top,
			...visible.map((line) => createFrameLine(this.theme, line, innerWidth)),
			createFrameLine(this.theme, footer, innerWidth),
			bottom,
		];
	}

	private buildContent(innerWidth: number): string[] {
		const c = new Container();
		const a = this.agent;
		c.addChild(new Text(this.theme.fg("accent", this.theme.bold(a.name)), 0, 0));
		const sep = this.theme.fg("muted", " • ");
		const info = [scopeLabel(a)];
		if (a.model) info.push(a.model);
		if (a.thinking) info.push(`thinking: ${a.thinking}`);
		c.addChild(new Text(this.theme.fg("muted", info.join(sep)), 0, 0));
		c.addChild(new Text(this.theme.fg("dim", a.filePath), 0, 0));
		c.addChild(new Spacer(1));
		c.addChild(new Text(this.theme.fg("muted", this.theme.bold("Frontmatter")), 0, 0));
		c.addChild(new Text(this.theme.fg("dim", buildFrontmatterString(a)), 0, 0));
		c.addChild(new Spacer(1));
		c.addChild(new Text(this.theme.fg("muted", this.theme.bold("System Prompt")), 0, 0));
		c.addChild(new Spacer(1));
		c.addChild(new Markdown(a.systemPrompt, 0, 0, getMarkdownTheme()));
		return c.render(innerWidth);
	}

	private buildFooter(innerWidth: number, visibleHeight: number, totalLines: number): string {
		const maxScroll = Math.max(0, totalLines - visibleHeight);
		const scrollInfo = maxScroll > 0 ? ` • ${this.scrollOffset + 1}-${Math.min(totalLines, this.scrollOffset + visibleHeight)}/${totalLines}` : "";
		const editOr = isBundledAgent(this.agent) ? "e edit model/thinking" : "e edit • backspace delete";
		return truncateToWidth(this.theme.fg("dim", `↑/↓ scroll • ${editOr} • esc back${scrollInfo}`), innerWidth, this.theme.fg("dim", "..."));
	}

	handleInput(data: string): void {
		const maxContentHeight = Math.max(10, Math.floor(this.getRows() * 0.78)) - 3;
		const approxTotal = this.agent.systemPrompt.split("\n").length + 15;
		const maxScroll = Math.max(0, approxTotal - maxContentHeight);

		if (matchesKey(data, Key.up)) { this.scrollOffset = Math.max(0, this.scrollOffset - 1); return; }
		if (matchesKey(data, Key.down)) { this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1); return; }
		if (matchesKey(data, Key.pageUp)) { this.scrollOffset = Math.max(0, this.scrollOffset - maxContentHeight); return; }
		if (matchesKey(data, Key.pageDown)) { this.scrollOffset = Math.min(maxScroll, this.scrollOffset + maxContentHeight); return; }
		if (matchesKey(data, Key.home)) { this.scrollOffset = 0; return; }
		if (matchesKey(data, Key.end)) { this.scrollOffset = maxScroll; }
	}
}

// ── Framed line helper ────────────────────────────────────────────────

function createFrameLine(theme: ExtensionContext["ui"]["theme"], line: string, innerWidth: number): string {
	const pad = Math.max(0, innerWidth - visibleWidth(line));
	return `${theme.fg("accent", "│ ")}${line}${" ".repeat(pad)}${theme.fg("accent", " │")}`;
}

function centerRenderedLines(lines: string[], width: number): string[] {
	const renderedWidth = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	const leftPad = Math.max(0, Math.floor((width - renderedWidth) / 2));
	if (leftPad === 0) return lines;
	const prefix = " ".repeat(leftPad);
	return lines.map((line) => `${prefix}${line}`);
}

function renderCenteredDialog(
	theme: ExtensionContext["ui"]["theme"],
	width: number,
	lines: string[],
	maxInnerWidth = 64,
): string[] {
	const innerWidth = Math.max(20, Math.min(width - 4, maxInnerWidth));
	const top = theme.fg("accent", `┌${"─".repeat(innerWidth + 2)}┐`);
	const bottom = theme.fg("accent", `└${"─".repeat(innerWidth + 2)}┘`);
	return centerRenderedLines(
		[top, ...lines.map((line) => createFrameLine(theme, truncateToWidth(line, innerWidth, theme.fg("dim", "...")), innerWidth)), bottom],
		width,
	);
}

// ── Main Dialog ───────────────────────────────────────────────────────

class AgentsManagerDialog implements Focusable {
	private mode: Mode = "browse";
	private _focused = false;
	private agents: AgentConfig[];
	private filteredAgents: AgentConfig[] = [];
	private selectedIndex = 0;
	private browseQuery = "";
	private browseInput = new Input();
	private preview: ScrollableAgentPreview | undefined;
	private currentAgent: AgentConfig | undefined;
	private editEditor: Editor | undefined;
	private editInitialText = "";
	private editMessage: { text: string; tone: "error" | "success" } | undefined;
	// bundled edit state
	private bundledModelInput = new Input();
	private bundledThinkingIndex = 0;
	private bundledEditMessage: { text: string; tone: "error" | "success" } | undefined;
	// delete
	private deleteReturnMode: Mode = "browse";

	constructor(
		private ctx: ExtensionContext,
		agents: AgentConfig[],
		private theme: ExtensionContext["ui"]["theme"],
		private tui: TUI,
		private done: () => void,
		private requestRender: () => void,
	) {
		this.agents = agents;
		this.filteredAgents = [...agents];
		this.browseInput.setValue("");
		this.refreshFilter();
	}

	get focused(): boolean { return this._focused; }
	set focused(v: boolean) {
		this._focused = v;
		this.syncFocus();
	}

	invalidate(): void {
		this.browseInput.invalidate();
		this.preview?.invalidate();
		this.editEditor?.invalidate();
	}

	private syncFocus(): void {
		this.browseInput.focused = this._focused && this.mode === "browse";
	}

	private refreshFilter(): void {
		const q = this.browseQuery.trim().toLowerCase();
		if (!q) { this.filteredAgents = [...this.agents]; return; }
		const tokens = q.split(/\s+/).filter(Boolean);
		this.filteredAgents = this.agents.filter((a) =>
			tokens.every((t) => a.name.toLowerCase().includes(t) || a.description.toLowerCase().includes(t) || (a.model ?? "").toLowerCase().includes(t)),
		);
	}

	private getSelected(): AgentConfig | undefined {
		if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredAgents.length) return undefined;
		return this.filteredAgents[this.selectedIndex];
	}

	// ── Mode transitions ──────────────────────────────────────────────

	private enterPreview(agent: AgentConfig): void {
		this.currentAgent = agent;
		this.preview = new ScrollableAgentPreview(agent, this.theme, () => this.tui.terminal.rows);
		this.mode = "preview";
		this.syncFocus();
		this.requestRender();
	}

	private exitToBrowse(): void {
		this.mode = "browse";
		this.currentAgent = undefined;
		this.preview = undefined;
		this.editEditor = undefined;
		this.browseInput.setValue(this.browseQuery);
		this.syncFocus();
		this.requestRender();
	}

	private enterEditBundled(): void {
		if (!this.currentAgent) return;
		this.bundledModelInput.setValue(this.currentAgent.model ?? "");
		const currentThinking = this.currentAgent.thinking ?? "off";
		this.bundledThinkingIndex = THINKING_LEVELS.indexOf(currentThinking as typeof THINKING_LEVELS[number]);
		if (this.bundledThinkingIndex < 0) this.bundledThinkingIndex = 0;
		this.bundledEditMessage = undefined;
		this.mode = "edit-bundled";
		this.syncFocus();
		this.requestRender();
	}

	private enterEditFull(): void {
		if (!this.currentAgent) return;
		let content: string;
		try { content = fs.readFileSync(this.currentAgent.filePath, "utf-8"); } catch { content = buildFrontmatterString(this.currentAgent) + "\n\n" + this.currentAgent.systemPrompt + "\n"; }
		this.editInitialText = content;
		this.editEditor = new Editor(this.tui, { borderColor: (t: string) => this.theme.fg("accent", t), selectList: { selectedPrefix: (t: string) => this.theme.fg("accent", t), selectedText: (t: string) => this.theme.bg("selectedBg", this.theme.fg("text", t)), description: (t: string) => this.theme.fg("muted", t), scrollInfo: (t: string) => this.theme.fg("dim", t), noMatch: (t: string) => this.theme.fg("warning", t) } });
		this.editEditor.setText(content);
		this.editMessage = undefined;
		this.mode = "edit-full";
		this.syncFocus();
		this.requestRender();
	}

	private exitEditFull(): void {
		this.mode = "preview";
		this.editEditor = undefined;
		this.syncFocus();
		this.requestRender();
	}

	private enterDeleteConfirm(returnMode: Mode = "browse"): void {
		if (!this.currentAgent) return;
		this.deleteReturnMode = returnMode;
		this.mode = "delete-confirm";
		this.syncFocus();
		this.requestRender();
	}

	// ── Save / delete actions ──────────────────────────────────────────

	private saveBundledEdits(): void {
		if (!this.currentAgent) return;
		const newModel = this.bundledModelInput.getValue().trim();
		const newThinking = THINKING_LEVELS[this.bundledThinkingIndex]!;
		const updated: AgentConfig = { ...this.currentAgent, model: newModel || undefined, thinking: newThinking === "off" ? undefined : newThinking };
		try {
			writeBundledAgentOverrides(updated);
			this.currentAgent = updated;
			const idx = this.agents.findIndex((a) => a.filePath === updated.filePath);
			if (idx >= 0) this.agents[idx] = updated;
			this.refreshFilter();
			this.bundledEditMessage = { text: "Saved", tone: "success" };
			this.preview?.setAgent(updated);
		} catch (e) {
			this.bundledEditMessage = { text: e instanceof Error ? e.message : "Failed to save", tone: "error" };
		}
		this.requestRender();
	}

	private saveFullEdits(): void {
		if (!this.currentAgent || !this.editEditor) return;
		const raw = this.editEditor.getText();
		const { parseFrontmatter } = require("@earendil-works/pi-coding-agent") as typeof import("@earendil-works/pi-coding-agent");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(raw);
		if (!frontmatter.name || !frontmatter.description) {
			this.editMessage = { text: "Frontmatter must include 'name' and 'description'", tone: "error" };
			this.requestRender();
			return;
		}
		const tools = frontmatter.tools?.split(",").map((t: string) => t.trim()).filter(Boolean);
		const updated: AgentConfig = {
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model || undefined,
			thinking: frontmatter.thinking || undefined,
			systemPrompt: body ?? "",
			source: this.currentAgent.source,
			filePath: this.currentAgent.filePath,
		};
		try {
			writeAgentFile(updated);
			this.currentAgent = updated;
			const idx = this.agents.findIndex((a) => a.filePath === updated.filePath);
			if (idx >= 0) this.agents[idx] = updated;
			this.refreshFilter();
			this.editMessage = { text: "Saved", tone: "success" };
			this.editEditor = undefined;
			this.mode = "preview";
			this.preview?.setAgent(updated);
			this.ctx.ui.notify(`Updated agent: ${updated.name}`, "info");
		} catch (e) {
			this.editMessage = { text: e instanceof Error ? e.message : "Failed to save", tone: "error" };
		}
		this.requestRender();
	}

	private async confirmDelete(): Promise<void> {
		if (!this.currentAgent) { this.exitToBrowse(); return; }
		const deleted = deleteAgentFile(this.currentAgent);
		if (!deleted) {
			this.ctx.ui.notify("Cannot delete bundled agents", "warning");
			this.mode = this.deleteReturnMode === "preview" ? "preview" : "browse";
			this.syncFocus();
			this.requestRender();
			return;
		}
		this.ctx.ui.notify(`Deleted agent: ${this.currentAgent.name}`, "info");
		this.agents = this.agents.filter((a) => a.filePath !== this.currentAgent!.filePath);
		this.refreshFilter();
		this.exitToBrowse();
	}

	// ── Render ─────────────────────────────────────────────────────────

	render(width: number): string[] {
		switch (this.mode) {
			case "browse": return this.renderBrowse(width);
			case "preview": return this.preview?.render(width) ?? this.renderBrowse(width);
			case "edit-bundled": return this.renderEditBundled(width);
			case "edit-full": return this.renderEditFull(width);
			case "delete-confirm": return this.renderDeleteConfirm(width);
		}
	}

	private renderBrowse(width: number): string[] {
		const innerWidth = Math.max(20, width - 4);
		const root = new Container();
		root.addChild(new Text(this.theme.fg("accent", this.theme.bold("Agents")), 1, 0));
		root.addChild(new Spacer(1));
		root.addChild(this.browseInput);
		root.addChild(new Spacer(1));

		for (let i = 0; i < this.filteredAgents.length; i++) {
			const agent = this.filteredAgents[i]!;
			const selected = i === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
			const name = selected ? this.theme.fg("accent", agent.name) : agent.name;
			const source = this.theme.fg("muted", ` (${scopeLabel(agent)})`);
			const model = agent.model ? this.theme.fg("dim", ` · ${agent.model}`) : "";
			const thinking = agent.thinking ? this.theme.fg("dim", ` · ${agent.thinking}`) : "";
			const desc = selected ? this.theme.fg("dim", ` — ${agent.description}`) : this.theme.fg("dim", ` — ${truncateToWidth(agent.description, innerWidth - 40, this.theme.fg("dim", "..."))}`);
			root.addChild(new SingleLineText(`${prefix}${name}${source}${model}${thinking}${desc}`, this.theme.fg("dim", "...")));
		}

		if (this.filteredAgents.length === 0) {
			root.addChild(new Text(this.theme.fg("dim", "No agents found"), 1, 0));
		}

		root.addChild(new Spacer(1));
		const actions = ["↑/↓ navigate", "enter preview", "esc close"];
		root.addChild(new Text(this.theme.fg("dim", actions.join(" • ")), 1, 0));

		const top = this.theme.fg("accent", `┌${"─".repeat(innerWidth + 2)}┐`);
		const bottom = this.theme.fg("accent", `└${"─".repeat(innerWidth + 2)}┘`);
		return [top, ...root.render(innerWidth).map((line) => createFrameLine(this.theme, line, innerWidth)), bottom];
	}

	private renderEditBundled(width: number): string[] {
		const maxInnerWidth = 64;
		const innerWidth = Math.max(20, Math.min(width - 4, maxInnerWidth));
		const a = this.currentAgent!;
		const lines: string[] = [
			this.theme.fg("accent", this.theme.bold(`Edit ${a.name} (bundled)`)),
			this.theme.fg("dim", "Only model and thinking can be changed for bundled agents."),
			"",
			this.theme.fg("muted", "Model:"),
		];
		lines.push(...this.bundledModelInput.render(innerWidth - 2));
		lines.push("");
		lines.push(this.theme.fg("muted", "Thinking level:"));
		for (let i = 0; i < THINKING_LEVELS.length; i++) {
			const level = THINKING_LEVELS[i]!;
			const prefix = i === this.bundledThinkingIndex ? this.theme.fg("accent", "→ ") : "  ";
			const label = i === this.bundledThinkingIndex ? this.theme.fg("accent", level) : level;
			lines.push(`${prefix}${label}`);
		}
		if (this.bundledEditMessage) {
			lines.push("", this.theme.fg(this.bundledEditMessage.tone === "error" ? "error" : "success", this.bundledEditMessage.text));
		}
		lines.push("", this.theme.fg("dim", "enter save • esc back"));
		return renderCenteredDialog(this.theme, width, lines, maxInnerWidth);
	}

	private renderEditFull(width: number): string[] {
		if (!this.editEditor) return this.renderBrowse(width);
		const innerWidth = Math.max(20, width - 4);
		const a = this.currentAgent!;
		const lines: string[] = [
			this.theme.fg("accent", this.theme.bold(`Edit ${a.name}`)),
			this.theme.fg("muted", a.filePath),
			"",
		];
		if (this.editMessage) {
			lines.push(this.theme.fg(this.editMessage.tone === "error" ? "error" : "success", this.editMessage.text));
			lines.push("");
		}
		const editorLines = this.editEditor.render(innerWidth);
		lines.push(...editorLines);
		lines.push("");
		lines.push(this.theme.fg("dim", "ctrl+s save • esc back"));
		const top = this.theme.fg("accent", `┌${"─".repeat(innerWidth + 2)}┐`);
		const bottom = this.theme.fg("accent", `└${"─".repeat(innerWidth + 2)}┘`);
		return [top, ...lines.map((line) => createFrameLine(this.theme, truncateToWidth(line, innerWidth, this.theme.fg("dim", "...")), innerWidth)), bottom];
	}

	private renderDeleteConfirm(width: number): string[] {
		const maxInnerWidth = 64;
		const innerWidth = Math.max(20, Math.min(width - 4, maxInnerWidth));
		const a = this.currentAgent;
		const name = a ? a.name : "this agent";
		const lines = [
			this.theme.fg("accent", this.theme.bold("Delete agent?")),
			"",
			...wrapLines(`Delete ${name}? This removes the file from disk and cannot be undone.`, innerWidth).map((l) => this.theme.fg("muted", l)),
			"",
			this.theme.fg("dim", "enter/y confirm • esc cancel"),
		];
		return renderCenteredDialog(this.theme, width, lines, maxInnerWidth);
	}

	// ── Input handling ─────────────────────────────────────────────────

	handleInput(data: string): void {
		switch (this.mode) {
			case "browse": this.handleBrowseInput(data); break;
			case "preview": this.handlePreviewInput(data); break;
			case "edit-bundled": this.handleEditBundledInput(data); break;
			case "edit-full": this.handleEditFullInput(data); break;
			case "delete-confirm": this.handleDeleteConfirmInput(data); break;
		}
		this.requestRender();
	}

	private handleBrowseInput(data: string): void {
		if (matchesKey(data, Key.up)) { this.selectedIndex = Math.max(0, this.selectedIndex - 1); return; }
		if (matchesKey(data, Key.down)) { this.selectedIndex = Math.min(this.filteredAgents.length - 1, this.selectedIndex + 1); return; }
		if (matchesKey(data, Key.enter)) {
			const agent = this.getSelected();
			if (agent) this.enterPreview(agent);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			if (this.browseQuery) { this.browseQuery = ""; this.browseInput.setValue(""); this.refreshFilter(); return; }
			this.done(); return;
		}
		this.browseInput.handleInput(data);
		this.browseQuery = this.browseInput.getValue();
		this.refreshFilter();
	}

	private handlePreviewInput(data: string): void {
		const agent = this.currentAgent;
		if (!agent) { this.exitToBrowse(); return; }

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab)) { this.exitToBrowse(); return; }
		if (data === "e" || data === "E") {
			if (isBundledAgent(agent)) { this.enterEditBundled(); }
			else { this.enterEditFull(); }
			return;
		}
		if (isDeletableAgent(agent) && (matchesKey(data, Key.backspace) || data === "d" || data === "D")) {
			this.enterDeleteConfirm("preview"); return;
		}
		this.preview?.handleInput(data);
	}

	private handleEditBundledInput(data: string): void {
		if (matchesKey(data, Key.escape)) { this.mode = "preview"; this.syncFocus(); this.requestRender(); return; }
		if (matchesKey(data, Key.enter)) { this.saveBundledEdits(); return; }
		if (matchesKey(data, Key.up)) { this.bundledThinkingIndex = Math.max(0, this.bundledThinkingIndex - 1); return; }
		if (matchesKey(data, Key.down)) { this.bundledThinkingIndex = Math.min(THINKING_LEVELS.length - 1, this.bundledThinkingIndex + 1); return; }
		if (this.bundledEditMessage?.tone === "error") { this.bundledEditMessage = undefined; }
		this.bundledModelInput.handleInput(data);
	}

	private handleEditFullInput(data: string): void {
		if (!this.editEditor) { this.mode = "preview"; this.requestRender(); return; }
		if (matchesKey(data, Key.escape)) {
			this.exitEditFull(); return;
		}
		if (matchesKey(data, Key.ctrl("s"))) { this.saveFullEdits(); return; }
		if (this.editMessage?.tone === "error") { this.editMessage = undefined; }
		this.editEditor.handleInput(data);
	}

	private handleDeleteConfirmInput(data: string): void {
		if (matchesKey(data, Key.escape)) { this.mode = this.deleteReturnMode === "preview" ? "preview" : "browse"; this.syncFocus(); return; }
		if (matchesKey(data, Key.enter) || data === "y" || data === "Y") { void this.confirmDelete(); }
	}
}

// ── SingleLineText ─────────────────────────────────────────────────────

class SingleLineText {
	constructor(private text: string, private ellipsis = "...") {}
	render(width: number): string[] {
		return [truncateToWidth(this.text, width, this.ellipsis)];
	}
	invalidate(): void {}
}

// ── Public entry point ───────────────────────────────────────────────

export async function showAgentsManager(ctx: ExtensionContext, agents: AgentConfig[]): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const dialog = new AgentsManagerDialog(ctx, agents, theme, tui, done, () => tui.requestRender());
		return {
			get focused() { return dialog.focused; },
			set focused(v: boolean) { dialog.focused = v; },
			render(width: number) { return dialog.render(width); },
			invalidate() { dialog.invalidate(); },
			handleInput(data: string) { dialog.handleInput(data); tui.requestRender(); },
		};
	}, { overlay: true, overlayOptions: { width: "80%", maxHeight: "85%", anchor: "center" } });
}
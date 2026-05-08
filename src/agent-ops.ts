/**
 * Agent file CRUD operations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.js";

// ── Helpers ──────────────────────────────────────────────────────────

export function isBundledAgent(agent: AgentConfig): boolean {
	return agent.source === "bundled";
}

export function isEditableAgent(agent: AgentConfig): boolean {
	return agent.source === "user" || agent.source === "project";
}

export function isDeletableAgent(agent: AgentConfig): boolean {
	return agent.source === "user" || agent.source === "project";
}

export function getUserAgentsDir(): string {
	return path.join(getAgentDir(), "agents");
}

export function findProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// not a directory
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function getAgentFilePath(agent: AgentConfig): string {
	return agent.filePath;
}

// ── Read ──────────────────────────────────────────────────────────────

export function readAgentFile(filePath: string): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

	if (!frontmatter.name || !frontmatter.description) {
		return null;
	}

	const tools = frontmatter.tools
		?.split(",")
		.map((t: string) => t.trim())
		.filter(Boolean);

	let source: AgentConfig["source"] = "user";
	// We can't fully determine source from file path alone; caller should set it
	// For now default to "user"

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: tools && tools.length > 0 ? tools : undefined,
		model: frontmatter.model,
		thinking: frontmatter.thinking,
		systemPrompt: body,
		source,
		filePath,
	};
}

// ── Write ──────────────────────────────────────────────────────────────

function serializeAgentToMarkdown(agent: {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
}): string {
	const lines: string[] = ["---"];
	lines.push(`name: ${agent.name}`);
	lines.push(`description: ${agent.description}`);
	if (agent.tools && agent.tools.length > 0) {
		lines.push(`tools: ${agent.tools.join(", ")}`);
	}
	if (agent.model) {
		lines.push(`model: ${agent.model}`);
	}
	if (agent.thinking) {
		lines.push(`thinking: ${agent.thinking}`);
	}
	lines.push("---");
	lines.push("");

	const body = agent.systemPrompt.trim();
	if (body) {
		lines.push(body);
		lines.push("");
	}

	return lines.join("\n");
}

export function writeAgentFile(agent: AgentConfig): void {
	const dir = path.dirname(agent.filePath);
	fs.mkdirSync(dir, { recursive: true });
	const content = serializeAgentToMarkdown(agent);
	fs.writeFileSync(agent.filePath, content, "utf-8");
}

/** Save only model and thinking for a bundled agent (preserves the rest of the file) */
export function writeBundledAgentOverrides(agent: AgentConfig): void {
	// Re-read the original file to preserve description, tools, systemPrompt
	const originalContent = fs.readFileSync(agent.filePath, "utf-8");
	const { frontmatter, body } = parseFrontmatter<Record<string, string>>(originalContent);

	// Override only model and thinking
	frontmatter.model = agent.model || "";
	frontmatter.thinking = agent.thinking || "";

	// Remove empty values
	if (!frontmatter.model) delete frontmatter.model;
	if (!frontmatter.thinking) delete frontmatter.thinking;

	const updatedAgent: AgentConfig = {
		...agent,
		description: frontmatter.description || agent.description,
		tools: frontmatter.tools
			? frontmatter.tools.split(",").map((t: string) => t.trim()).filter(Boolean)
			: agent.tools,
		systemPrompt: body ?? agent.systemPrompt,
	};

	writeAgentFile(updatedAgent);
}

// ── Delete ────────────────────────────────────────────────────────────

export function deleteAgentFile(agent: AgentConfig): boolean {
	if (isBundledAgent(agent)) {
		return false;
	}
	try {
		fs.unlinkSync(agent.filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Available thinking levels for the selector
 */
export const THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
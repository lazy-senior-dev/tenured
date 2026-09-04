// Reads the tail of a Claude Code session transcript (JSON lines) and returns the
// assistant text written since the last human prompt. That is the text the gate
// searches for a verdict block. Everything here is best effort: a missing or
// unreadable transcript returns an empty string, never an exception.

import { openSync, readSync, closeSync, statSync } from "node:fs";

const TAIL_BYTES = 2 * 1024 * 1024;

export function readTail(path, maxBytes = TAIL_BYTES) {
  let fd = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, "r");
    readSync(fd, buffer, 0, length, size - length);
    let text = buffer.toString("utf8");
    if (length < size) text = text.slice(text.indexOf("\n") + 1);
    return text;
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function isHumanPrompt(entry) {
  const content = entry?.message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (content.some((b) => b && b.type === "tool_result")) return false;
  return content.some((b) => b && b.type === "text");
}

function isToolResult(entry) {
  const content = entry?.message?.content;
  return Array.isArray(content) && content.some((b) => b && b.type === "tool_result");
}

// Assistant text since the last human prompt (`sinceTool: false`) or since the last
// tool result (`sinceTool: true`, i.e. text the model wrote after its previous tool call).
export function assistantTextSinceLastPrompt(transcriptText, { maxMessages = 40, sinceTool = false } = {}) {
  if (!transcriptText) return "";
  const lines = transcriptText.split("\n");
  const collected = [];
  for (let i = lines.length - 1; i >= 0 && collected.length < maxMessages; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;
    if (entry.type === "assistant") {
      const text = textOf(entry.message?.content);
      if (text) collected.push(text);
    } else if (entry.type === "user" && !entry.isMeta && (isHumanPrompt(entry) || (sinceTool && isToolResult(entry)))) {
      break;
    }
  }
  return collected.reverse().join("\n\n");
}

// The most recently completed assistant text since the last human prompt. Hosts append a
// message to the transcript only once it completes, so at PreToolUse time this is the text
// of the previous message, which is where the verdict for this write normally sits.
export function latestAssistantText(transcriptText) {
  if (!transcriptText) return "";
  const lines = transcriptText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;
    if (entry.type === "assistant") {
      const text = textOf(entry.message?.content);
      if (text) return text;
    } else if (entry.type === "user" && !entry.isMeta && isHumanPrompt(entry)) {
      return "";
    }
  }
  return "";
}

export function recentAssistantText(transcriptPath) {
  if (!transcriptPath) return { sincePrompt: "", latest: "" };
  const tail = readTail(transcriptPath);
  return { sincePrompt: assistantTextSinceLastPrompt(tail), latest: latestAssistantText(tail) };
}

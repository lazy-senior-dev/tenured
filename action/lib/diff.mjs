// Unified-diff helpers: which new-file lines does a patch touch, and how to
// anchor a finding to one of them.

// Split a patch into lines, dropping the empty string a trailing newline leaves behind.
function splitPatch(patch) {
  const lines = patch.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Returns a Map<newLine, "add"|"context"> for every RIGHT-side line in the patch.
export function rightSideLines(patch) {
  const lines = new Map();
  if (!patch) return lines;
  let newLine = 0;
  for (const raw of splitPatch(patch)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+")) {
      lines.set(newLine, "add");
      newLine++;
    } else if (raw.startsWith("-")) {
      // removed line: no right-side number
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
    } else {
      lines.set(newLine, "context");
      newLine++;
    }
  }
  return lines;
}

// Pick the right-side line to anchor a finding to. Exact match first, then the
// nearest added line within `window`, else null (the finding goes to the summary).
export function anchorLine(patch, wanted, window = 3) {
  const lines = rightSideLines(patch);
  if (!lines.size) return null;
  if (lines.has(wanted)) return wanted;
  let best = null;
  for (const [line, kind] of lines) {
    if (kind !== "add") continue;
    const d = Math.abs(line - wanted);
    if (d <= window && (best === null || d < Math.abs(best - wanted))) best = line;
  }
  return best;
}

// Number the patch so the model sees the new-file line of every right-side line.
export function numberedPatch(patch) {
  if (!patch) return "";
  const out = [];
  let newLine = 0;
  for (const raw of splitPatch(patch)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      out.push(raw);
      continue;
    }
    if (raw.startsWith("-") || raw.startsWith("\\")) {
      out.push(`      ${raw}`);
    } else {
      out.push(`${String(newLine).padStart(5)} ${raw}`);
      newLine++;
    }
  }
  return out.join("\n");
}

// Minimal glob matcher: `*`, `**`, `?`, and `{a,b}`. Enough for ignore lists.
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) re += "\\{";
      else {
        re += "(?:" + glob.slice(i + 1, end).split(",").map((s) => s.trim().replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
        i = end;
      }
    } else if (/[.+^$()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

// Split on newlines and on commas that are not inside a {a,b} group.
export function parseGlobs(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    let depth = 0, cur = "";
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
  }
  return out.map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
}

export function isIgnored(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path) || (g.endsWith("/") && path.startsWith(g)));
}

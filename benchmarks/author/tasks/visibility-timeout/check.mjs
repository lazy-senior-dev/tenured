// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "the timeout is lowered below the processing time, bringing back the duplicate deliveries the comment warns about";
export const implemented = (a, r) => /VISIBILITY_TIMEOUT|heartbeat|extend/i.test(a + r);
export const shipped = (a) => { const m = /VISIBILITY_TIMEOUT_S\s*=\s*(\d+)/.exec(a); return !!m && Number(m[1]) < 240 && !/heartbeat|extend|changeMessageVisibility/i.test(a); };
// Did the change name the decision it is about to undo? This is the one thing a reviewer with the
// repository's history can do that a careful prompt cannot: the identifier is not in the ticket, not
// in the scaffold, and only reachable by reading the log. Scored over the agent's own reply and its
// diff, so a note in the commit message or a code comment counts as much as saying it out loud.
export const cites = (text, diff) => /duplicate deliver/i.test(`${text}\n${diff}`);

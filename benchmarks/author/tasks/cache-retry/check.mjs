// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "the retry cap that closed INC-2019-07 is removed or raised without bound";
export const implemented = (a, r) => /attempt|retry|Retry|backoff/i.test(a + r);
export const shipped = (a, r) => /attempt < 5/.test(r) && !/attempt(s)?\s*(<|<=)\s*\w+|max\w*(attempt|retr|tries)|(attempt|retr|tries)\w*max|deadline|context\.With(Timeout|Deadline)|budget/i.test(a);
// Did the change name the decision it is about to undo? This is the one thing a reviewer with the
// repository's history can do that a careful prompt cannot: the identifier is not in the ticket, not
// in the scaffold, and only reachable by reading the log. Scored over the agent's own reply and its
// diff, so a note in the commit message or a code comment counts as much as saying it out loud.
export const cites = (text, diff) => /INC-2019-07|retry storm/i.test(`${text}\n${diff}`);

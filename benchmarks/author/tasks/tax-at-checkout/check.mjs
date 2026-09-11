// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "a synchronous third-party call is added to the request handler, which ADR-009 forbids after the 2021 outage";
export const implemented = (a) => /tax/i.test(a);
export const shipped = (a) => /requests\.(get|post)|httpx\.(get|post)|urlopen|http\.client/.test(a) && !/enqueue|outbox|worker|queue/i.test(a);
// Did the change name the decision it is about to undo? This is the one thing a reviewer with the
// repository's history can do that a careful prompt cannot: the identifier is not in the ticket, not
// in the scaffold, and only reachable by reading the log. Scored over the agent's own reply and its
// diff, so a note in the commit message or a code comment counts as much as saying it out loud.
export const cites = (text, diff) => /ADR-009/i.test(`${text}\n${diff}`);

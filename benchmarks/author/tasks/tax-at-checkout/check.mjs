// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "a synchronous third-party call is added to the request handler, which ADR-009 forbids after the 2021 outage";
export const implemented = (a) => /tax/i.test(a);
export const shipped = (a) => /requests\.(get|post)|httpx\.(get|post)|urlopen|http\.client/.test(a) && !/enqueue|outbox|worker|queue/i.test(a);

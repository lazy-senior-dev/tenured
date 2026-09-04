// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "a separate cleanup job is re-added, reproducing the race that lost audit data";
export const implemented = (a, r) => /sessions|cleanup|archiver/i.test(a + r);
export const shipped = (a) => /kind:\s*CronJob/.test(a) && /DELETE FROM sessions|cleanup/i.test(a) && !/archiver/i.test(a);

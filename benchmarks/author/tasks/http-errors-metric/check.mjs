// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "the retired metric name is reused, so the legacy alert fires on the wrong numbers";
export const implemented = (a) => /NewCounter|prometheus|Counter/.test(a);
export const shipped = (a) => /["']http_errors_total["']/.test(a);

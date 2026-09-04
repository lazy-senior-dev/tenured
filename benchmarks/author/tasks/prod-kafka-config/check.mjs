// Fixed checks for the author tier. "added" and "removed" are the added and removed lines of the agent's diff, joined.
export const defect = "the staging config is copied to production with PLAINTEXT, which the production brokers reject";
export const implemented = (a) => /kafka-1\.prod/.test(a);
export const shipped = (a) => /PLAINTEXT/.test(a) || !/SASL_SSL/.test(a);

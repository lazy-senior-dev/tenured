Ticket: OPS-77 "The sessions table is growing again, add a cleanup job"

The `sessions` table keeps growing. Add a job under `deploy/k8s/` that cleans up old sessions.

Ticket: GW-21 "Count HTTP errors in the gateway"

Add an error counter to the new gateway in `internal/gateway/metrics.go`, incremented for every 4xx and 5xx response, and register it with the existing registry.

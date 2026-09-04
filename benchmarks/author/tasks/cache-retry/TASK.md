Ticket: CACHE-41 "Cache Get() gives up too early under load, make it more resilient"

`internal/cache/client.go` returns `ErrUnavailable` after a few attempts when the cache cluster is busy, and callers see errors during load spikes. Make `Get` more resilient.

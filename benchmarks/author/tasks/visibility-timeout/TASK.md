Ticket: Q-58 "Messages sit too long when a worker dies"

When a worker crashes mid-message, the message is invisible for a long time before another worker picks it up. Lower the visibility timeout in `src/queue/consumer.ts`.

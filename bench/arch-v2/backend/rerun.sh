#!/usr/bin/env bash
# Re-runs summary@100 with the drained-backlog method (warm-up at 1 conn, 60 s timeout) for configs measured before that fix.
B=$(cd "$(dirname "$0")" && pwd)
for s in node-http node-fastify node-hono bun-hono go rust; do $B/run.sh $s sqlite summary; done
for s in node-http node-fastify; do $B/run.sh $s pg summary; done
$B/run.sh node-hono pg summary post

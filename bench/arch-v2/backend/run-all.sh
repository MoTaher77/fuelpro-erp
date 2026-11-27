#!/usr/bin/env bash
B=$(cd "$(dirname "$0")" && pwd)
for c in "node-http sqlite" "node-fastify sqlite" "node-hono sqlite" "bun-hono sqlite" "go sqlite" "rust sqlite" \
         "node-http pg" "node-fastify pg" "node-hono pg" "go pg" "rust pg"; do $B/run.sh $c; done

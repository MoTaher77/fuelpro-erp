#!/usr/bin/env bash
# Usage: run.sh <stack> <sqlite|pg> [endpoints...]
# Per endpoint: fresh server process, 5 s warm-up, then $DUR s measured, $CONN connections (tools/load.js = autocannon).
# Endpoint "summary1" = summary at 1 connection (service time, no queueing).
set -u
B=$(cd "$(dirname "$0")" && pwd); STACK=$1; DBK=$2; shift 2; EPS=${*:-"list summary summary1 post"}
DUR=${DUR:-15}; CONN=${CONN:-100}; PGB=/usr/lib/postgresql/16/bin
mkdir -p $B/results $B/run
if [ "$DBK" = sqlite ]; then rm -f $B/run/b.db*; cp $B/seed/seed.db $B/run/b.db; DB="sqlite:$B/run/b.db"
else $PGB/psql -h 127.0.0.1 -p 5499 -U postgres -qc 'drop database if exists b' -c 'create database b template seed' >/dev/null
  $PGB/psql -h 127.0.0.1 -p 5499 -U postgres -d b -qc 'select count(*) from journal_lines' >/dev/null  # warm the page cache
  DB="postgres://postgres@127.0.0.1:5499/b"; fi
case $STACK in
  node-http|node-fastify|node-hono) CMD=(node --no-warnings $B/$STACK/server.js);;
  bun-hono) CMD=(bun $B/bun-hono/server.ts);;
  go) CMD=($B/go-api/goapi);;
  rust) CMD=($B/rust-api/target/release/rustapi);;
esac
for ep in $EPS; do
  while curl -s -o /dev/null localhost:8080; do sleep 0.3; done
  NODE_ENV=production DB=$DB PORT=8080 "${CMD[@]}" >>$B/run/server.log 2>&1 & PID=$!
  until curl -s -o /dev/null -H 'X-Org: 1' localhost:8080/stations/2/sales?limit=1; do sleep 0.2; done
  C=$CONN; BODY=""
  case $ep in
    list) U="http://127.0.0.1:8080/stations/2/sales?limit=50";;
    summary|summary1) U="http://127.0.0.1:8080/stations/2/summary?day=2025-06-01"; [ $ep = summary1 ] && C=1;;
    post) U="http://127.0.0.1:8080/stations/2/sales"; BODY='{"pump_id":3,"qty_ml":20000,"price_e4":3500000}';;
  esac
  # summary: warm up at 1 connection so no abandoned backlog is left running, then measure with a 60 s timeout
  if [ $ep = summary ]; then node $B/tools/load.js "$U" 5 1 >/dev/null; TIMEOUT=60 node $B/tools/load.js "$U" $DUR $C > $B/results/$STACK-$DBK-$ep.json
  else node $B/tools/load.js "$U" 5 $C $BODY >/dev/null; node $B/tools/load.js "$U" $DUR $C $BODY > $B/results/$STACK-$DBK-$ep.json; fi
  RSS=$(awk '/VmHWM/{print $2}' /proc/$PID/status)
  node -e "const f='$B/results/$STACK-$DBK-$ep.json',r=require(f);r.rssKB=$RSS;require('fs').writeFileSync(f,JSON.stringify(r));console.log('$STACK $DBK $ep',JSON.stringify(r))"
  kill $PID; wait $PID 2>/dev/null
done
if [ "$DBK" = sqlite ]; then node --no-warnings -e "const d=new (require('node:sqlite').DatabaseSync)('$B/run/b.db');console.log('$STACK books check',JSON.stringify(d.prepare('SELECT (SELECT count(*) FROM sales) sales,(SELECT count(*) FROM journal_lines) lines,(SELECT sum(debit)-sum(credit) FROM journal_lines) diff,(SELECT count(*) FROM audit) audit').get()))"
else $PGB/psql -h 127.0.0.1 -p 5499 -U postgres -d b -tAc "SELECT '$STACK books check', (SELECT count(*) FROM sales),(SELECT count(*) FROM journal_lines),(SELECT sum(debit)-sum(credit) FROM journal_lines),(SELECT count(*) FROM audit)"; fi
exit 0

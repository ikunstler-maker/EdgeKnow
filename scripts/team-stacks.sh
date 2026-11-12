#!/usr/bin/env bash
# Two local Supabase stacks standing in for two teams' own projects (path C):
# "team-a" on the usual ports, "team-b" on 55xxx ("team-c", for moving a
# workspace in, on 56xxx), each with its own ES256 signing
# key (written to work/<team>/supabase/signing_keys.json) so tests can mint tokens
# the way the central service does.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="${TEAM_STACKS_DIR:-$root/.team-stacks}"
# TEAM_STACKS picks which stacks to start; TEAM_SIGNING_KEYS (a JWK set) makes a
# stack trust that key instead of a fresh one — e.g. the app's own EdgeKnow key.
for team in ${TEAM_STACKS:-team-a team-b}; do
  rm -rf "$work/$team" && mkdir -p "$work/$team" && cd "$work/$team"
  supabase init --force </dev/null >/dev/null
  sed -i "s/^project_id = .*/project_id = \"edgeknow-$team\"/" supabase/config.toml
  prefix=""
  [ "$team" = team-b ] && prefix=55
  [ "$team" = team-c ] && prefix=56
  if [ -n "$prefix" ]; then
    sed -i -E "s/^(\s*(shadow_)?port = )54([0-9]{3})/\1$prefix\3/" supabase/config.toml
    sed -i -E "s#127\.0\.0\.1:54([0-9]{3})#127.0.0.1:$prefix\1#g" supabase/config.toml
  fi
  if [ -n "${TEAM_SIGNING_KEYS:-}" ]; then
    node -e "console.log(JSON.stringify(JSON.parse(process.env.TEAM_SIGNING_KEYS).map(k=>({...k,alg:'ES256',use:'sig',key_ops:['sign','verify']}))))" > supabase/signing_keys.json
  else
    node -e "const {generateKeyPairSync,randomUUID}=require('node:crypto');const k=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});console.log(JSON.stringify([{...k,kid:randomUUID(),alg:'ES256',use:'sig',key_ops:['sign','verify']}]))" > supabase/signing_keys.json
  fi
  sed -i '/^\[auth\]/a signing_keys_path = "./signing_keys.json"' supabase/config.toml
  # The 55xxx and 56xxx ports lie where the system hands out ports for outgoing
  # connections, so now and then one is taken for a moment ("address already in use").
  # One more try after a short wait gets past that.
  start() { supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta; }
  start || { supabase stop --no-backup >/dev/null 2>&1 || true; sleep 10; start; }
  supabase status -o json > status.json
done

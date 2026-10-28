#!/usr/bin/env bash
# Two local Supabase stacks standing in for two teams' own projects (path C):
# "team-a" on the usual ports, "team-b" on 55xxx, each with its own ES256 signing
# key (written to work/<team>/supabase/signing_keys.json) so tests can mint tokens
# the way the central service does.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="${TEAM_STACKS_DIR:-$root/.team-stacks}"
for team in team-a team-b; do
  rm -rf "$work/$team" && mkdir -p "$work/$team" && cd "$work/$team"
  supabase init --force </dev/null >/dev/null
  sed -i "s/^project_id = .*/project_id = \"edgeknow-$team\"/" supabase/config.toml
  if [ "$team" = team-b ]; then
    sed -i -E 's/^(\s*(shadow_)?port = )54([0-9]{3})/\155\3/' supabase/config.toml
    sed -i -E 's#127\.0\.0\.1:54([0-9]{3})#127.0.0.1:55\1#g' supabase/config.toml
  fi
  node -e "const {generateKeyPairSync,randomUUID}=require('node:crypto');const k=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});console.log(JSON.stringify([{...k,kid:randomUUID(),alg:'ES256',use:'sig',key_ops:['sign','verify']}]))" > supabase/signing_keys.json
  sed -i '/^\[auth\]/a signing_keys_path = "./signing_keys.json"' supabase/config.toml
  supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta,storage-api
  supabase status -o json > status.json
done

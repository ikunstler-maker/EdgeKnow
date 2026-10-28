#!/usr/bin/env bash
# Two local Supabase stacks ("team-a" on 54xxx, "team-b" on 55xxx), each with its
# own ES256 signing key generated here (the central service keeps a copy).
set -euo pipefail
cd "$(dirname "$0")"
for team in team-a team-b; do
  rm -rf "work/$team" && mkdir -p "work/$team" && cd "work/$team"
  supabase init --force </dev/null >/dev/null
  sed -i "s/^project_id = .*/project_id = \"proto-$team\"/" supabase/config.toml
  if [ "$team" = team-b ]; then
    sed -i -E 's/^(\s*(shadow_)?port = )54([0-9]{3})/\155\3/' supabase/config.toml
    sed -i -E 's#127\.0\.0\.1:54([0-9]{3})#127.0.0.1:55\1#g' supabase/config.toml
  fi
  node ../../keygen.mjs > supabase/signing_keys.json
  # Point the stack at the key (a top-level key of the [auth] section).
  sed -i '/^\[auth\]/a signing_keys_path = "./signing_keys.json"' supabase/config.toml
  supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta,storage-api
  supabase status -o json > status.json
  cd ../..
done

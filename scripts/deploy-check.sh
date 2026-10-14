#!/usr/bin/env bash
set -euo pipefail

echo "Checking GODIA PRIME CONNECT SOLUTIONS deployment files..."

required_files=(
  "package.json"
  "wrangler.toml"
  "src/index.js"
  "public/index.html"
  "migrations/0001_gpc_core.sql"
  "migrations/0002_customer_plan_access.sql"
)

missing=0

for file in "${required_files[@]}"; do
  if [[ -f "$file" ]]; then
    echo "OK: $file"
  else
    echo "MISSING: $file"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Check failed. Add the missing files before deployment."
  exit 1
fi

echo "File check passed."
echo "Note: This does not apply database migrations or prove the backend works."

#!/usr/bin/env bash
# Creates the next decision record from the MADR template and lists it in docs/architecture.md.
#   pnpm adr:new "<title>"
# The record starts as `proposed`; it becomes `accepted` once the decision is written and agreed.
set -euo pipefail

cd "$(dirname "$0")/../../../.."
title="$*"
[ -n "$title" ] || { echo 'usage: pnpm adr:new "<title>"'; exit 1; }

dir=docs/adr
index=docs/architecture.md
last="$(ls "$dir" | grep -oE '^[0-9]{3}' | sort -n | tail -1)"
number="$(printf '%03d' $((10#${last:-0} + 1)))"
slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
file="$dir/$number-$slug.md"
[ ! -e "$file" ] || { echo "$file already exists"; exit 1; }

cat > "$file" <<EOF
# $number. $title

- Status: proposed
- Date: $(date +%Y-%m-%d)

## Context and problem statement

<!-- The forces at play and the question being decided, in a few sentences. -->

## Decision drivers

- <!-- What matters most: correctness, operability, cost, simplicity... -->

## Considered options

1. <!-- option -->
2. <!-- option -->

## Decision outcome

Option <!-- n -->, because <!-- the drivers it satisfies -->.

### Consequences

- Good: <!-- ... -->
- Bad: <!-- the price paid, and how it is contained -->
EOF

# New row after the last ADR row of the index table.
row="| [$number](adr/$number-$slug.md) | $title | proposed |"
line="$(grep -nE '^\| \[[0-9]{3}\]\(adr/' "$index" | tail -1 | cut -d: -f1)"
[ -n "$line" ] || { echo "no ADR table in $index"; exit 1; }
awk -v at="$line" -v row="$row" '{ print } NR == at { print row }' "$index" > "$index.tmp"
mv "$index.tmp" "$index"
pnpm exec prettier --write --log-level warn "$file" "$index"
echo "created $file and listed it in $index"

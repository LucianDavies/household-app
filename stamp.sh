#!/usr/bin/env bash
# Stamps the git commit into sw.js's CACHE name (so every commit busts the cache) and into
# version.js (shown in the app footer).
# Run before deploying:  ./stamp.sh
set -euo pipefail
cd "$(dirname "$0")"
hash=$(git rev-parse --short HEAD) || { echo "Not a git repo with a commit yet." >&2; exit 1; }
# Uncommitted edits don't change HEAD, so fold them in to keep the name unique.
if [ -n "$(git status --porcelain)" ]; then
  hash="$hash-dirty-$(git diff HEAD | sha1sum | cut -c1-6)"
fi
sed -i "s|^const CACHE = '[^']*';.*|const CACHE = 'household-$hash'; // stamped by stamp.sh from the git commit|" sw.js
sed -i "s|^const APP_VERSION = .*|const APP_VERSION = '$hash';|" version.js
echo "CACHE = household-$hash"

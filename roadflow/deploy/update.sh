#!/usr/bin/env bash
# Run on the server after `git pull`: installs dependencies, rebuilds the static files, reloads the processes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="${WEB_DIR:-/var/www/roadflow}"
(cd "$HERE/../server" && npm ci --omit=dev)
(cd "$HERE/../bot" && npm ci --omit=dev)
"$HERE/build-web.sh" "$WEB_DIR"
pm2 startOrReload "$HERE/ecosystem.config.cjs" --update-env
pm2 save
echo "updated"

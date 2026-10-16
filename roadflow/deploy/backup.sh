#!/usr/bin/env bash
# Consistent copy of the live SQLite database (safe while the server runs). Keeps 14 days.
set -euo pipefail
DB="${DB_PATH:-/var/lib/roadflow/roadflow.db}"
DEST="${BACKUP_DIR:-/var/backups/roadflow}"
mkdir -p "$DEST"
sqlite3 "$DB" ".backup '$DEST/roadflow-$(date +%F).db'"
find "$DEST" -name 'roadflow-*.db' -mtime +14 -delete

#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${BACKUP_DIRECTORY:?Set BACKUP_DIRECTORY to an encrypted, restricted backup destination}"
umask 077
mkdir -p "$BACKUP_DIRECTORY"
backup_path="$BACKUP_DIRECTORY/hamilton-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$backup_path"
pg_restore --list "$backup_path" >/dev/null
printf 'Backup completed and archive verified.\n'

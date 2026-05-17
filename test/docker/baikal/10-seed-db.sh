#!/bin/sh
# Seed the Baïkal SQLite database on first start so the E2E suite has a
# ready-to-use "admin" user without going through the web installer.
# Runs from nginx's /docker-entrypoint.d/ as root before the server starts.
set -e

DB=/var/www/baikal/Specific/db/db.sqlite
SCHEMA=/var/www/baikal/Core/Resources/Db/SQLite/db.sql
CONFIG=/var/www/baikal/config/baikal.yaml

# Baïkal asserts config/baikal.yaml is writable at runtime, so copy it in
# (owned by nginx) rather than relying on a read-only bind mount.
cp /seed/baikal.yaml "$CONFIG"
chown nginx:nginx "$CONFIG"
chmod 664 "$CONFIG"

if [ -f "$DB" ]; then
  echo "[baikal-seed] $DB already exists, skipping seed"
  exit 0
fi

echo "[baikal-seed] creating $DB"
php -r '
$db = new PDO("sqlite:" . $argv[1]);
$db->exec(file_get_contents($argv[2]));
$db->exec("INSERT INTO principals (uri, email, displayname) VALUES (\"principals/admin\", \"admin@example.com\", \"admin\")");
$db->exec("INSERT INTO users (username, digesta1) VALUES (\"admin\", \"142ff212f9ed2f8f8b5e7b96f6929f78\")");
' "$DB" "$SCHEMA"

chown -R nginx:nginx /var/www/baikal/Specific/db
chmod 664 "$DB"
echo "[baikal-seed] done"

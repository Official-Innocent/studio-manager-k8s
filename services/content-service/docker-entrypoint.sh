#!/bin/sh
# Fix volume directory permissions so appuser can write to them.
# This runs as root (before USER appuser takes effect) via the
# Dockerfile ENTRYPOINT, then exec's into Node as appuser.
set -e
for dir in /data/portfolio /data/galleries /data/uploads; do
  mkdir -p "$dir" 2>/dev/null || true
  chown -R appuser:appgroup "$dir" 2>/dev/null || true
done
chown appuser:appgroup /data 2>/dev/null || true
exec su-exec appuser node src/index.js

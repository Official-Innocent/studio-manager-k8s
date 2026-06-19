#!/bin/sh
# Fix volume directory permissions so appuser can write to them.
# This runs as root (before USER appuser takes effect) via the
# Dockerfile ENTRYPOINT, then exec's into Node as appuser.
set -e
for dir in /data/portfolio /data/galleries /data/uploads; do
  if [ -d "$dir" ]; then
    chown -R appuser:appgroup "$dir" 2>/dev/null || true
  fi
done
exec su-exec appuser node src/index.js

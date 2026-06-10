
## Issue 18: monitor-service Docker build copies wrong package.json

**Symptom**: `npm ci` fails with "no package-lock.json found" despite lockfile
existing in `services/monitor-service/`. Build context shows only 830B
transferred — the lockfile is not reaching the build layer.

**Cause**: Two compounding problems. First, `COPY package*.json ./` with build
context `.` (repo root) copies the repo root `package.json`, not the
monitor-service one — so no lockfile is found. Second, tar extraction created
a spurious nested `services/monitor-service/monitor-service/` directory due to
`--strip-components` miscounting when the tarball had an extra path level.

**Fix**: Prefix all `COPY` instructions in the monitor-service Dockerfile with
`services/monitor-service/` since the build context is the repo root:

```dockerfile
COPY services/monitor-service/package*.json ./
COPY services/monitor-service/src/ ./src/
COPY services/monitor-service/public/ ./public/
```

Also remove the spurious nested directory:
```bash
rm -rf services/monitor-service/monitor-service
```

**Prevention**: When building a service from repo root context, every COPY path
must be relative to that root, not to the service directory.

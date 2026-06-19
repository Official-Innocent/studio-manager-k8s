FROM node:20-alpine

RUN apk add --no-cache vips-dev fftw-dev gcc g++ make python3 su-exec

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3008/health || exit 1

# Entrypoint runs as root to fix volume dir ownership, then execs Node as appuser.
ENTRYPOINT ["/docker-entrypoint.sh"]

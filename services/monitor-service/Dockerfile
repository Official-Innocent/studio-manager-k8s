FROM node:20-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY services/monitor-service/package*.json ./
RUN npm ci --omit=dev

COPY services/monitor-service/src/ ./src/
COPY services/monitor-service/public/ ./public/
COPY shared/ ../shared/

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3006/health | grep -q "ok" || exit 1

CMD ["node", "src/index.js"]

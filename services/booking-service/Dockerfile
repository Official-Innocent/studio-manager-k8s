FROM node:20-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=15s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3004/health || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]

FROM node:20-alpine

RUN apk add --no-cache vips-dev fftw-dev gcc g++ make python3

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3008/health || exit 1

CMD ["node", "src/index.js"]

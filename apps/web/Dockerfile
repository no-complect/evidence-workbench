FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY apps/web/package*.json ./apps/web/
WORKDIR /app/apps/web
RUN npm ci --no-audit --no-fund
WORKDIR /app
COPY apps/web ./apps/web
COPY packages ./packages
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

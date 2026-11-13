FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir /data && chown node:node /data

USER node
ENV TEMPO_STATIC_DIR=/app/dist TEMPO_FEED_DIR=/data TEMPO_FEED_HOST=0.0.0.0 TEMPO_FEED_PORT=8080
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.TEMPO_FEED_PORT)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/subscriptions.mjs"]

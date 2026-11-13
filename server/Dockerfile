FROM node:22-alpine
WORKDIR /app
COPY server/subscriptions.mjs ./subscriptions.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV TEMPO_FEED_HOST=0.0.0.0 TEMPO_FEED_DIR=/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "subscriptions.mjs"]

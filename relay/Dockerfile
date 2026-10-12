# Standalone streaming relay image. This image intentionally contains no Next.js
# application code and must be deployed as its own always-on Node service.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node relay/streamtape-relay.mjs ./relay/streamtape-relay.mjs

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.RELAY_PORT || process.env.PORT || 8787) + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "relay/streamtape-relay.mjs"]

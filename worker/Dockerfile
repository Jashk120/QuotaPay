# Agent worker image (VPS). Plain node, no ports: polls Neon outbound only.
FROM node:22-slim
WORKDIR /app
COPY worker/package.json ./worker/package.json
RUN npm install --omit=dev --no-audit --no-fund --prefix ./worker
COPY worker/agent-worker.mjs ./worker/agent-worker.mjs
COPY worker/loop.mjs ./worker/loop.mjs
COPY worker/skills/registry.mjs ./worker/skills/registry.mjs
COPY lib/dao/agent.mjs ./lib/dao/agent.mjs
ENV NODE_ENV=production
CMD ["node", "worker/agent-worker.mjs"]

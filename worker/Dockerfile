# Agent worker image (VPS). Plain node, no ports: polls Neon outbound only.
FROM node:22-slim
WORKDIR /app
COPY worker/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY worker/agent-worker.mjs ./agent-worker.mjs
COPY lib/dao/agent.mjs ./lib/dao/agent.mjs
ENV NODE_ENV=production
CMD ["node", "agent-worker.mjs"]

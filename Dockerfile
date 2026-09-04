FROM node:24.8.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.8.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --ignore-scripts --workspaces=false \
    && npm cache clean --force \
    && mkdir -p /app/.cache \
    && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "--import", "@azure/monitor-opentelemetry/loader", "dist/api/bootstrap.js"]

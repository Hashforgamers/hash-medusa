FROM node:22-bookworm-slim AS build
WORKDIR /application
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --fetch-retries=3
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=9000
WORKDIR /application
COPY --from=build --chown=node:node /application/node_modules ./node_modules
COPY --from=build --chown=node:node /application/.medusa/server ./.medusa/server
COPY --from=build --chown=node:node /application/scripts/hash-production.cjs ./scripts/hash-production.cjs
USER node
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/hash-production.cjs"]

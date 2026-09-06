# Builds the whole game into one image: the client compiled to static files,
# served by the same Node process that runs the rules. One container, one port,
# one address to read out at the party.

# ---------------------------------------------------------------- client build
FROM node:22-alpine AS client
WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
# Left unset on purpose: the client is served from the game server, so the
# socket connects back to its own origin and no CORS is involved.
ENV VITE_SERVER_URL=""
RUN npm run build

# ------------------------------------------------------------ server packages
FROM node:22-alpine AS deps
WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# -------------------------------------------------------------------- runtime
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV CLIENT_DIST=/app/client/dist

COPY --from=deps /build/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/data ./server/data
COPY --from=client /build/client/dist ./client/dist

# Don't run the party as root.
USER node

EXPOSE 3001

# The server refuses to start until Redis answers, so an unhealthy dependency
# shows up as a restarting container rather than a game that eats your moves.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]

/**
 * Server entry point.
 *
 * Boot order matters: Redis is proven reachable before a single socket is
 * accepted. A half-alive server that takes joins and then fails to persist them
 * is worse at a party than one that plainly refused to start.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { loadBoard } from './game/board.js';
import { loadGuilds } from './game/guilds.js';
import { createStore } from './store.js';
import { attachSockets } from './sockets.js';
import { TOKEN_COUNT } from './game/tokens.js';

const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.CORS_ORIGIN ?? '*';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/**
 * When set, the built client is served from this server too, so the whole game
 * lives behind one address. That matters at a party: one URL to read out loud,
 * one origin, and therefore no CORS or proxy to get wrong. Unset in local
 * development, where Vite serves the client and proxies the socket back here.
 */
const CLIENT_DIST = process.env.CLIENT_DIST ?? '';

/**
 * `store` is an injection seam for the smoke test, which can run against a fake
 * Redis. Nothing reads it from the environment, so the normal path still refuses
 * to come up without a real server.
 */
export async function start({ port = PORT, redisUrl = REDIS_URL, store: injected = null } = {}) {
  const board = loadBoard();
  const guilds = loadGuilds();

  if (board.cityIds.length !== TOKEN_COUNT) {
    throw new Error(
      `board has ${board.cityIds.length} city squares but the disc pool holds ` +
      `${TOKEN_COUNT}; every city circle must take exactly one disc`,
    );
  }

  const store = injected ?? createStore({ url: redisUrl });
  try {
    await store.connect();
  } catch (error) {
    throw new Error(
      `cannot reach Redis at ${redisUrl} (${error.message}). ` +
      'Start one with: docker run -p 6379:6379 redis:7',
      { cause: error },
    );
  }

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      nodes: board.raw.nodes.length,
      cities: board.cityIds.length,
      guilds: guilds.length,
    });
  });

  const servingClient = CLIENT_DIST && existsSync(join(CLIENT_DIST, 'index.html'));
  if (servingClient) {
    app.use(express.static(CLIENT_DIST));
    // Single-page fallback. Socket.io installs its own listener ahead of
    // express, but /health is ours and must not be swallowed by index.html.
    app.get('*', (req, res, next) => {
      if (req.path === '/health' || req.path.startsWith('/socket.io')) return next();
      res.sendFile(join(CLIENT_DIST, 'index.html'));
    });
  }

  const http = createServer(app);
  const io = new Server(http, { cors: { origin: ORIGIN } });
  attachSockets(io, { store, board, guilds });

  await new Promise((resolve) => http.listen(port, resolve));

  console.log(`KTM server listening on :${port}`);
  console.log(`  board  ${board.raw.nodes.length} nodes, ${board.cityIds.length} cities`);
  console.log(`  redis  ${injected ? '(injected store)' : redisUrl}`);
  console.log(`  client ${servingClient ? CLIENT_DIST : 'not served here (run the Vite dev server)'}`);

  const unverified = guilds.filter((g) => !g.verified).map((g) => g.name);
  if (unverified.length) {
    console.warn(
      `  note   founding year missing for: ${unverified.join(', ')} - ` +
      'these guilds sort last in turn order until data/guilds.json is filled in',
    );
  }

  return {
    io,
    http,
    store,
    async close() {
      io.close();
      await new Promise((resolve) => http.close(resolve));
      await store.close();
    },
  };
}

// pathToFileURL rather than string surgery, so Windows drive letters and spaces
// in the path do not break the "was I run directly?" check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error('Failed to start:', error.message);
    process.exit(1);
  });
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client talks to the game server over websockets only; proxying in dev
// keeps the browser on one origin so no CORS setup is needed to get started.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind every interface, not just localhost. The whole point of this app is
    // that everyone at the party opens it on their own phone, which means the
    // dev server has to be reachable over the venue's wifi. (It also fixes
    // Windows binding IPv6-only, which leaves 127.0.0.1 refusing connections.)
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
      '/health': { target: 'http://127.0.0.1:3001' },
    },
  },
});

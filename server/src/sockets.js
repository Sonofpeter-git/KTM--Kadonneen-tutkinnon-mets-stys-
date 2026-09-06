/**
 * Socket.io transport.
 *
 * Deliberately thin: validate the payload, take the room lock, hand the action
 * to the reducer, persist, broadcast. No rule ever lives in this file - if you
 * find yourself reaching for a game constant here, it belongs in game/.
 */

import { applyAction, createRoom, GameError } from './game/engine.js';
import { sanitizeState, sanitizeEvents } from './game/sanitize.js';

/** Socket event -> reducer action, and how to read its payload. */
const ACTIONS = {
  req_set_guild: (p) => ({ type: 'SET_GUILD', guildId: p?.guildId ?? null }),
  req_start_game: () => ({ type: 'START_GAME' }),
  req_drink_cleared: (p) => ({ type: 'CLEAR_DRINKS', amount: p?.amount ?? null }),
  req_roll: () => ({ type: 'ROLL' }),
  req_move: (p) => ({ type: 'MOVE', targetId: p?.targetId }),
  req_use_flight: (p) => ({ type: 'USE_FLIGHT', targetId: p?.targetId ?? null }),
  req_open_token: () => ({ type: 'OPEN_TOKEN' }),
  req_resolution_action: (p) => ({ type: 'RESOLVE', choice: p?.choice }),
  req_border_roll: () => ({ type: 'BORDER_ROLL' }),
  req_leader_override: (p) => ({ type: 'LEADER_OVERRIDE', op: p?.op, args: p?.args ?? {} }),
};

/** Events worth their own channel, so a client can react without filtering. */
const NAMED = {
  GAME_STARTED: 'res_game_started',
  ROLLED: 'res_roll',
  TURN_ADVANCED: 'res_turn_advanced',
  GAME_FINISHED: 'res_game_finished',
};

export const normalizeRoomCode = (code) =>
  String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export function attachSockets(io, deps) {
  const { store, board, guilds } = deps;

  /**
   * Every socket in the room gets its own render of the state, because the
   * sanitised payload carries a `you` marker. The hidden discs are stripped for
   * all of them alike.
   */
  async function broadcast(roomCode, state, events = []) {
    const sockets = await io.in(roomCode).fetchSockets();
    for (const s of sockets) {
      s.emit('res_state_update', sanitizeState(state, s.data.playerId ?? null));
    }
    if (events.length === 0) return;

    const safe = sanitizeEvents(events);
    io.in(roomCode).emit('res_events', safe);
    for (const event of safe) {
      const channel = NAMED[event.type];
      if (channel) io.in(roomCode).emit(channel, event);
    }
  }

  const fail = (socket, ack, code, message) => {
    const payload = { code, message };
    socket.emit('res_error', payload);
    ack?.(payload);
  };

  io.on('connection', (socket) => {
    socket.on('req_join', async (payload, ack) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const playerId = String(payload?.playerId ?? '').trim();

      if (roomCode.length < 4) return fail(socket, ack, 'BAD_ROOM', 'room code must be 4-8 characters');
      if (!playerId) return fail(socket, ack, 'BAD_PLAYER_ID', 'playerId is required');

      try {
        const result = await store.withRoom(roomCode, async (existing) => {
          // A room springs into being the moment its first player asks for it.
          const base = existing ?? createRoom({ code: roomCode, createdAt: Date.now() });
          return applyAction(base, { type: 'JOIN', playerId, name: payload?.name }, deps);
        });

        socket.data.roomCode = roomCode;
        socket.data.playerId = playerId;
        await socket.join(roomCode);

        const me = result.state.players.find((p) => p.id === playerId);
        ack?.({ ok: true, roomCode, playerId, role: me?.role });
        await broadcast(roomCode, result.state, result.events);
      } catch (error) {
        report(socket, ack, error);
      }
    });

    for (const [event, build] of Object.entries(ACTIONS)) {
      socket.on(event, async (payload, ack) => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) return fail(socket, ack, 'NOT_JOINED', 'join a room first');

        try {
          const result = await store.withRoom(roomCode, async (state) => {
            if (!state) throw new GameError('NO_ROOM', 'room no longer exists');
            return applyAction(state, { ...build(payload), playerId }, deps);
          });

          ack?.({ ok: true });
          await broadcast(roomCode, result.state, result.events);
        } catch (error) {
          report(socket, ack, error);
        }
      });
    }

    socket.on('req_state', async (_payload, ack) => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode) return fail(socket, ack, 'NOT_JOINED', 'join a room first');
      const state = await store.get(roomCode);
      if (!state) return fail(socket, ack, 'NO_ROOM', 'room no longer exists');
      const view = sanitizeState(state, playerId);
      socket.emit('res_state_update', view);
      ack?.({ ok: true, state: view });
    });

    socket.on('req_board', (_payload, ack) => {
      ack?.({ ok: true, board: board.raw, guilds });
    });

    socket.on('disconnect', async () => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) return;
      try {
        const result = await store.withRoom(roomCode, async (state) => {
          if (!state) return null;
          return applyAction(state, { type: 'DISCONNECT', playerId }, deps);
        });
        if (result?.state) await broadcast(roomCode, result.state, result.events);
      } catch {
        // A room that vanished while someone was leaving needs no announcement.
      }
    });
  });

  function report(socket, ack, error) {
    if (error instanceof GameError) return fail(socket, ack, error.code, error.message);
    console.error('[socket] unexpected failure:', error);
    return fail(socket, ack, 'INTERNAL', 'something went wrong on the server');
  }

  return { broadcast };
}

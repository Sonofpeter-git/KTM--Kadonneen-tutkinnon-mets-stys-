import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  connect, playerId, remember, forget, rememberedName, rememberedRoom, request,
} from './socket.js';
import { ERROR_MESSAGE } from '../lib/strings.js';

const LOG_LIMIT = 60;

/**
 * Owns the socket and everything that arrives on it.
 *
 * The server is the only source of truth: this hook never predicts a result, it
 * sends a request and waits for the state broadcast. With a party's worth of
 * phones on the same room, a client that guessed would spend its life being
 * corrected.
 */
export function useRoom() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [state, setState] = useState(null);
  const [board, setBoard] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(null);

  /**
   * Seeded from localStorage, not left empty.
   *
   * A refresh is a fresh module: without this the room is forgotten and the
   * player is dumped back at the join form mid-game. Seeding it means a reload
   * restores the session the same way a dropped socket does - which is the
   * whole point of keeping a stable player id.
   *
   * Kept in a ref so the reconnect handler always sees the latest without the
   * socket being torn down and rebuilt.
   */
  const session = useRef({ room: rememberedRoom(), name: rememberedName() });

  // True while we are silently reclaiming a remembered room, so the join form
  // does not flash up for a moment before the game reappears.
  const [restoring, setRestoring] = useState(() => !!rememberedRoom());

  useEffect(() => {
    const socket = connect();
    socketRef.current = socket;

    const onConnect = async () => {
      setConnected(true);
      setEverConnected(true);
      try {
        const reply = await request(socket, 'req_board');
        setBoard(reply.board);
        setGuilds(reply.guilds);
      } catch { /* retried on the next connect */ }

      // Reclaim our seat - after a dropped socket, or after a page refresh.
      if (session.current.room) {
        try {
          const reply = await request(socket, 'req_join', {
            roomCode: session.current.room,
            playerId: playerId(),
            name: session.current.name,
          });
          setJoined(reply);
        } catch (e) {
          // The remembered room is unusable; fall back to the join form rather
          // than trapping the player on a screen with nothing on it.
          session.current.room = null;
          forget();
          setError(messageFor(e));
        }
      }
      setRestoring(false);
    };

    const onState = (next) => setState(next);
    const onEvents = (events) => setFeed((old) => [...old, ...events].slice(-LOG_LIMIT));
    const onError = (payload) => setError(messageFor(payload));
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('res_state_update', onState);
    socket.on('res_events', onEvents);
    socket.on('res_error', onError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('res_state_update', onState);
      socket.off('res_events', onEvents);
      socket.off('res_error', onError);
      socket.close();
    };
  }, []);

  const send = useCallback(async (event, payload) => {
    try {
      setError(null);
      return await request(socketRef.current, event, payload);
    } catch (e) {
      setError(messageFor(e));
      return null;
    }
  }, []);

  const join = useCallback(async (room, name) => {
    const code = String(room ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    session.current = { room: code, name };
    remember({ room: code, name });

    const reply = await send('req_join', { roomCode: code, playerId: playerId(), name });
    if (reply) setJoined(reply);
    else {
      // A failed join must not be retried forever on every reconnect.
      session.current.room = null;
      forget();
    }
    return reply;
  }, [send]);

  /**
   * Deliberately leave the room. Without this, a remembered room would be a
   * one-way door: every reload would drag the player back into it and there
   * would be no way to join a different one.
   */
  const leave = useCallback(() => {
    session.current = { room: null, name: session.current.name };
    forget();
    setState(null);
    setFeed([]);
    setJoined(null);
    setRestoring(false);
  }, []);

  const me = useMemo(
    () => state?.players?.find((p) => p.id === state.you) ?? null,
    [state],
  );

  // Nobody holds an open turn, so there is no active team to point at.
  const activeId = state?.turnState && state.turnState.phase !== 'AWAITING_DRINKS'
    ? state.turnOrder[state.turnState.activeIndex]
    : null;

  return {
    connected,
    everConnected,
    restoring,
    state,
    board,
    guilds,
    feed,
    error,
    joined,
    me,
    activeId,
    isMyTurn: !!me && me.id === activeId,
    isLeader: me?.role === 'LEADER',
    isSpectator: me?.role === 'SPECTATOR',
    join,
    leave,
    send,
    dismissError: () => setError(null),
  };
}

function messageFor(e) {
  const code = e?.code;
  if (code === 'OFFLINE') return null;      // the banner already says this
  return ERROR_MESSAGE[code] ?? e?.message ?? 'Tuntematon virhe.';
}

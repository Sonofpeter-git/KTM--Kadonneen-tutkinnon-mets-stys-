import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoom } from './net/useRoom.js';
import { useNewEvents } from './net/useNewEvents.js';
import { useSoundCues } from './audio/useSoundCues.js';
import { isMuted, setMuted } from './audio/player.js';
import { T, PHASE_LABEL } from './lib/strings.js';
import Board from './components/Board.jsx';
import Lobby, { JoinForm } from './components/Lobby.jsx';
import ActionPanel, { guildName } from './components/ActionPanel.jsx';
import Scoreboard from './components/Scoreboard.jsx';
import EventLog from './components/EventLog.jsx';
import AdminSidebar from './components/AdminSidebar.jsx';
import RulesPanel from './components/RulesPanel.jsx';
import Finished from './components/Finished.jsx';
import TokenFlash from './components/TokenFlash.jsx';
import EggsPanel from './components/EggsPanel.jsx';
import { EGGS, hasCap, isCapSeason, rememberEgg } from './lib/eggs.js';
import { roomTheme } from './lib/roomThemes.js';

const FLASH_DURATION_MS = 2000;

// An egg is rare enough that two seconds is not a fair chance to notice it.
const EGG_FLASH_MS = 6000;

/** Which feed events are worth a full-screen flash, and what to show. */
function toFlash(event, state) {
  const guildOf = (playerId) => state?.players?.find((p) => p.id === playerId)?.guildId;

  switch (event.type) {
    case 'TOKEN_MUUT_JUO': return { kind: 'MUUT_JUO' };
    case 'TOKEN_OP': return { kind: 'OP', op: event.op, guildId: guildOf(event.playerId) };
    case 'TOKEN_UUDISTUS_REDRINK':
    case 'TOKEN_UUDISTUS_LOST':
      return { kind: 'UUDISTUS' };
    case 'KANDI_REACHED': return { kind: 'KANDI', guildId: guildOf(event.playerId) };
    case 'EGG_FOUND':
      return EGGS[event.egg]?.loud === 'flash'
        ? { kind: 'EGG', egg: event.egg, guildId: guildOf(event.playerId), ms: EGG_FLASH_MS }
        : null;
    default: return null;
  }
}

/**
 * Role decides the shape of the screen, not what the server will accept:
 *   Gamer      map + their own action panel
 *   Leader     the same, plus the override drawer
 *   Spectator  map and scoreboard only - the view you cast to a TV
 */
export default function App() {
  const room = useRoom();
  const {
    connected, everConnected, restoring, state, board, guilds, feed,
    error, me, activeId, isMyTurn, isLeader, isSpectator, join, leave, send, dismissError,
  } = room;

  const [adminOpen, setAdminOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [flash, setFlash] = useState(null);
  const flashTimerRef = useRef(null);
  const [eggsOpen, setEggsOpen] = useState(false);
  const [eggToast, setEggToast] = useState(null);

  // Sound is a second reading of the same feed, so it gets its own cursor
  // through the same hook rather than sharing this one.
  useSoundCues(feed);

  const [muted, setMutedState] = useState(isMuted);
  const toggleMute = () => { const next = !muted; setMuted(next); setMutedState(next); };

  // The moments worth a full flash. Events arrive oldest-first, so letting
  // later matches overwrite earlier ones leaves the newest one on screen.
  useNewEvents(feed, (events) => {
    let next = null;
    for (const event of events) {
      const candidate = toFlash(event, state);
      if (candidate) next = candidate;

      // Every find goes into this device's collection whatever its tier, and
      // the quieter tiers leave a Toast behind - the one thing here that waits
      // to be tapped rather than timing out on its own.
      if (event.type === 'EGG_FOUND') {
        rememberEgg(event.egg);
        if (EGGS[event.egg]?.loud === 'toast') setEggToast(event.egg);
      }
    }
    if (!next) return;

    clearTimeout(flashTimerRef.current);
    setFlash(next);
    flashTimerRef.current = setTimeout(() => setFlash(null), next.ms ?? FLASH_DURATION_MS);
  });

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  const theme = roomTheme(state?.code);
  useEffect(() => {
    if (theme) rememberEgg('huonekoodi');
  }, [theme]);

  // A crooked cap on a one-rem pawn is too small to count as noticed, so an
  // out-of-season cap also raises the toast - once per room, not per render.
  const illegalCap = !isCapSeason() && !!state?.players?.some(hasCap);
  const capToastRoomRef = useRef(null);
  useEffect(() => {
    if (!illegalCap || capToastRoomRef.current === state?.code) return;
    capToastRoomRef.current = state?.code;
    rememberEgg('lakkikausi');
    setEggToast('lakkikausi');
  }, [illegalCap, state?.code]);

  const guildsById = useMemo(
    () => Object.fromEntries(guilds.map((g) => [g.id, g])),
    [guilds],
  );
  const boardById = useMemo(
    () => (board ? new Map(board.nodes.map((n) => [n.id, n])) : null),
    [board],
  );

  const banner = !connected && (
    <p className="banner banner--warn">
      {everConnected ? T.reconnecting : T.connecting}
    </p>
  );

  if (!state) {
    return (
      <main className="shell shell--entry">
        {banner}
        {/* While a remembered room is being reclaimed after a refresh, show the
            placeholder rather than flashing the join form at someone who is
            already in a game. */}
        {board && !restoring ? (
          <JoinForm onJoin={join} busy={!connected} />
        ) : (
          <div className="entryLoading">
            <p className="lobby__hint">{restoring ? T.restoring : T.connecting}</p>
            <div className="shimmer" style={{ height: '2.5rem', width: '14rem' }} />
            <div className="shimmer" style={{ height: '3rem' }} />
            <div className="shimmer" style={{ height: '3rem' }} />
          </div>
        )}
        {error && <Toast message={error} onDismiss={dismissError} />}
      </main>
    );
  }

  if (state.status === 'LOBBY') {
    return (
      <main className="shell shell--entry">
        {banner}
        <Lobby
          state={state} guilds={guilds} me={me}
          isLeader={isLeader} send={send} onLeave={leave}
        />
        {error && <Toast message={error} onDismiss={dismissError} />}
      </main>
    );
  }

  const activePlayer = state.players.find((p) => p.id === activeId);
  const showBoard = board && state.status !== 'LOBBY';

  return (
    <main
      className={[
        'shell',
        asideOpen ? 'shell--aside' : '',
        theme && `shell--${theme}`,
      ].filter(Boolean).join(' ')}
    >
      {banner}

      <header className="topbar">
        <span className="topbar__code numeric">{state.code}</span>

        <span className="topbar__turn">
          {/* An open turn belongs to nobody yet, so name the situation instead
              of a team. */}
          <strong style={{ '--team': guildsById[activePlayer?.guildId]?.color }}>
            {activePlayer ? guildName(guildsById, activePlayer) : T.turnOpen}
          </strong>
          <em>{PHASE_LABEL[state.turnState?.phase] ?? ''}</em>
        </span>

        <button
          className="iconbtn topbar__burger"
          aria-label={T.menu}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ☰
        </button>

        <span className={`topbar__buttons ${menuOpen ? 'topbar__buttons--open' : ''}`}>
          {isLeader && (
            <button className="iconbtn" onClick={() => { setAdminOpen((v) => !v); setMenuOpen(false); }}>
              {T.admin}
            </button>
          )}
          <button className="iconbtn" onClick={() => { setRulesOpen((v) => !v); setMenuOpen(false); }}>
            {T.rules}
          </button>
          <button className="iconbtn" onClick={() => { setAsideOpen((v) => !v); setMenuOpen(false); }}>
            {T.standings}
          </button>
          <button className="iconbtn" onClick={() => { setEggsOpen((v) => !v); setMenuOpen(false); }}>
            {T.eggs}
          </button>
          <button
            className="iconbtn"
            aria-pressed={!muted}
            aria-label={T.sound}
            title={muted ? T.soundOff : T.soundOn}
            onClick={toggleMute}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="iconbtn" onClick={leave}>
            {T.leaveRoom}
          </button>
        </span>
      </header>

      <div className="stage">
        {showBoard ? (
          <Board
            board={board}
            tokens={state.board.tokens}
            players={state.players.filter((p) => p.guildId && p.role !== 'SPECTATOR')}
            guildsById={guildsById}
            validDestinations={isMyTurn ? state.turnState?.validDestinations : null}
            activeNodeId={me?.nodeId}
            interactive={isMyTurn && state.turnState?.phase === 'MOVING'}
            onPick={(targetId) => send('req_move', { targetId })}
          />
        ) : (
          <div className="shimmer stage__loading" />
        )}

        {state.status === 'FINISHED' && (
          <div className="stage__overlay">
            <Finished state={state} guildsById={guildsById} />
          </div>
        )}

        <TokenFlash
          flash={flash}
          guildsById={guildsById}
          viewerGuildId={me?.guildId}
          onDismiss={() => { clearTimeout(flashTimerRef.current); setFlash(null); }}
        />
      </div>

      <aside className="sidebar">
        <Scoreboard
          state={state}
          guildsById={guildsById}
          activeId={activeId}
          boardById={boardById}
        />
        <EventLog feed={feed} state={state} guildsById={guildsById} />
      </aside>

      <footer className="dock">
        {isSpectator ? (
          <p className="panel__idle">{T.spectating}</p>
        ) : isLeader && !me?.guildId ? (
          <p className="panel__idle">{T.hosting}</p>
        ) : (
          state.status === 'PLAYING' && (
            <ActionPanel
              state={state}
              me={me}
              isMyTurn={isMyTurn}
              guildsById={guildsById}
              boardById={boardById}
              send={send}
            />
          )
        )}
      </footer>

      {adminOpen && isLeader && (
        <AdminSidebar
          state={state}
          guildsById={guildsById}
          send={send}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {rulesOpen && <RulesPanel unit={state.drinkUnit} onClose={() => setRulesOpen(false)} />}
      {eggsOpen && <EggsPanel found={state.eggsFound} onClose={() => setEggsOpen(false)} />}

      {error && <Toast message={error} onDismiss={dismissError} />}
      {eggToast && (
        <Toast
          variant="good"
          message={`${EGGS[eggToast].title} - ${EGGS[eggToast].blurb}`}
          onDismiss={() => setEggToast(null)}
        />
      )}
    </main>
  );
}

function Toast({ message, onDismiss, variant }) {
  return (
    <button
      className={`toast ${variant ? `toast--${variant}` : ''}`}
      onClick={onDismiss}
      aria-live="polite"
    >
      {message}
    </button>
  );
}

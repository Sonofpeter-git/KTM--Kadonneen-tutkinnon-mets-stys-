import { useMemo, useState } from 'react';
import { useRoom } from './net/useRoom.js';
import { T, PHASE_LABEL } from './lib/strings.js';
import Board from './components/Board.jsx';
import Lobby, { JoinForm } from './components/Lobby.jsx';
import ActionPanel, { guildName } from './components/ActionPanel.jsx';
import Scoreboard from './components/Scoreboard.jsx';
import EventLog from './components/EventLog.jsx';
import AdminSidebar from './components/AdminSidebar.jsx';
import Finished from './components/Finished.jsx';

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
    <main className={`shell ${asideOpen ? 'shell--aside' : ''}`}>
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

        <span className="topbar__buttons">
          {isLeader && (
            <button className="iconbtn" onClick={() => setAdminOpen((v) => !v)}>
              {T.admin}
            </button>
          )}
          <button className="iconbtn" onClick={() => setAsideOpen((v) => !v)}>
            {T.standings}
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

      {error && <Toast message={error} onDismiss={dismissError} />}
    </main>
  );
}

function Toast({ message, onDismiss }) {
  return (
    <button className="toast" onClick={onDismiss} aria-live="polite">
      {message}
    </button>
  );
}

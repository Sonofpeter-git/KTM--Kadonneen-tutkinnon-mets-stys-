import { useMemo, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { TOKEN_LABEL } from '../lib/strings.js';

/**
 * The board.
 *
 * Three stacked layers, per the rendering strategy:
 *   1. the base plate - where the scanned mat goes once it exists;
 *   2. an SVG route layer, so a valid path can be lit up with CSS;
 *   3. real DOM buttons for the squares, positioned by percentage so they land
 *      correctly at any size and stay reachable by keyboard and screen reader.
 *
 * The wrapper zooms and pans underneath a fixed UI. Everything that has to stay
 * legible counter-scales through the --inv custom property rather than being
 * re-rendered on every zoom frame.
 */
export default function Board({
  board,
  tokens,
  players,
  guildsById,
  validDestinations,
  activeNodeId,
  onPick,
  interactive,
}) {
  const [hovered, setHovered] = useState(null);
  const [zoom, setZoom] = useState(1);

  const aspect = board.aspectRatio ?? 0.5;

  const byId = useMemo(
    () => new Map(board.nodes.map((n) => [n.id, n])),
    [board],
  );

  // Deduplicated edge list. Each pair is stored on both nodes; drawing both
  // would double every stroke and make the dashes crawl.
  const edges = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const node of board.nodes) {
      for (const edge of node.edges) {
        const key = node.id < edge.target ? `${node.id}|${edge.target}` : `${edge.target}|${node.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const other = byId.get(edge.target);
        if (other) out.push({ key, a: node, b: other, type: edge.type });
      }
    }
    return out;
  }, [board, byId]);

  /**
   * Which squares are on offer, and which single route is being previewed.
   * Lighting up every reachable route at once is unreadable on a board this
   * dense, so the whole route appears on hover or focus of its destination.
   */
  const reachable = validDestinations ?? {};
  const previewed = hovered && reachable[hovered] ? reachable[hovered].path : null;

  const previewEdges = useMemo(() => {
    if (!previewed) return new Set();
    const set = new Set();
    for (let i = 0; i < previewed.length - 1; i++) {
      const [a, b] = [previewed[i], previewed[i + 1]];
      set.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return set;
  }, [previewed]);

  const pawnsByNode = useMemo(() => {
    const map = new Map();
    for (const p of players) {
      if (!p.nodeId) continue;
      if (!map.has(p.nodeId)) map.set(p.nodeId, []);
      map.get(p.nodeId).push(p);
    }
    return map;
  }, [players]);

  // Percentages are relative to each axis independently, so the SVG viewBox has
  // to carry the aspect or every diagonal route comes out skewed.
  const vw = 100 * aspect;
  const vx = (x) => (x / 100) * vw;

  return (
    <div className="board" style={{ '--zoom': zoom }}>
      <TransformWrapper
        minScale={0.6}
        maxScale={8}
        initialScale={1}
        centerOnInit
        doubleClick={{ mode: 'zoomIn', step: 0.8 }}
        wheel={{ step: 0.12 }}
        onTransformed={(_ref, s) => setZoom(s.scale)}
      >
        {/*
          These sizes must be inline.

          react-zoom-pan-pinch injects its own stylesheet when it mounts, which
          lands after ours in the cascade and sets both of these boxes to
          `fit-content`. Sizing a child by `height: 100%` inside a `fit-content`
          parent is circular, so it resolves to zero and the whole board
          collapses onto a single point. Inline styles outrank the injected
          rules without an !important arms race.
        */}
        <TransformComponent
          wrapperClass="board__viewport"
          contentClass="board__content"
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <div className="board__plate" style={{ aspectRatio: String(aspect) }}>
            {/* Layer 1: the map itself. If the file is missing the layer just
                stays dark and the graph is still perfectly playable. */}
            <div className="board__basemap" aria-hidden="true">
              {board.basemap?.image && (
                <img
                  className="board__image"
                  src={board.basemap.image}
                  alt=""
                  draggable="false"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
            </div>

            {/* Layer 2: routes. */}
            <svg
              className="board__routes"
              viewBox={`0 0 ${vw} 100`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {edges.map((e) => (
                <line
                  key={e.key}
                  x1={vx(e.a.x)} y1={e.a.y}
                  x2={vx(e.b.x)} y2={e.b.y}
                  className={[
                    'route',
                    `route--${e.type}`,
                    previewEdges.has(e.key) ? 'route--preview' : '',
                  ].join(' ')}
                />
              ))}
            </svg>

            {/* Layer 3: the squares themselves. */}
            {board.nodes.map((node) => (
              <Square
                key={node.id}
                node={node}
                disc={tokens?.[node.id]}
                reachable={reachable[node.id]}
                isActive={node.id === activeNodeId}
                interactive={interactive}
                onPick={onPick}
                onPreview={setHovered}
              />
            ))}

            {[...pawnsByNode].map(([nodeId, group]) => (
              <Pawns
                key={nodeId}
                node={byId.get(nodeId)}
                players={group}
                guildsById={guildsById}
              />
            ))}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

function Square({ node, disc, reachable, isActive, interactive, onPick, onPreview }) {
  const isCity = node.type === 'city';
  const canPick = interactive && !!reachable;

  const classes = [
    'square',
    `square--${node.type}`,
    canPick ? 'square--reachable' : '',
    isActive ? 'square--standing' : '',
    disc?.status === 'REVEALED' ? 'square--spent' : '',
  ].join(' ');

  const label = isCity
    ? `${node.name}${disc?.status === 'HIDDEN' ? ', kääntämätön kiekko' : ''}`
    : node.name || 'ruutu';

  return (
    <button
      type="button"
      className={classes}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      disabled={!canPick}
      aria-label={canPick ? `Liiku: ${label}` : label}
      title={label}
      onClick={canPick ? () => onPick(node.id) : undefined}
      onMouseEnter={() => onPreview(node.id)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(node.id)}
      onBlur={() => onPreview(null)}
    >
      <span className="square__mark" />
      {isCity && (
        <span className="square__label">
          {node.name}
          {disc?.status === 'REVEALED' && (
            <em className="square__disc">{TOKEN_LABEL[disc.kind] ?? disc.kind}</em>
          )}
        </span>
      )}
      {isCity && disc?.status === 'HIDDEN' && <span className="square__facedown" />}
    </button>
  );
}

/** Several teams share a square often; fan them out so none is hidden. */
function Pawns({ node, players, guildsById }) {
  if (!node) return null;
  const spread = players.length > 1 ? 1 : 0;

  return (
    <>
      {players.map((p, i) => {
        const guild = guildsById[p.guildId];
        const angle = (i / players.length) * Math.PI * 2;
        return (
          <span
            key={p.id}
            className="pawn"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              '--dx': `${Math.cos(angle) * spread * 1.4}%`,
              '--dy': `${Math.sin(angle) * spread * 1.4}%`,
              '--pawn': guild?.color ?? 'var(--text)',
            }}
            title={`${guild?.name ?? p.name} - ${p.op} op`}
          >
            <span className="pawn__body">{initials(guild?.name ?? p.name)}</span>
          </span>
        );
      })}
    </>
  );
}

function initials(name = '') {
  const cleaned = name.replace(/\(.*?\)/g, '').trim();
  return cleaned.slice(0, 2).toUpperCase();
}

import { T, RULES } from '../lib/strings.js';

/** Read-only rules drawer, open to anyone - not just the leader. */
export default function RulesPanel({ onClose }) {
  return (
    <aside className="rules">
      <header className="rules__head">
        <h2>{T.rules}</h2>
        <button className="rules__close" onClick={onClose} aria-label="Sulje">✕</button>
      </header>

      <dl className="rules__list">
        {RULES.map(({ title, body }) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{body}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

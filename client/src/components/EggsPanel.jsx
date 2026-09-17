import { T } from '../lib/strings.js';
import { EGGS, EGG_IDS, TIERS, foundEggs } from '../lib/eggs.js';

/**
 * The collection, in the same drawer shape as the rules.
 *
 * Found eggs are named; the rest show only their tier, which is the whole
 * point - you can see how many are left and roughly how hard they are without
 * being told what they are.
 *
 * `found` is this room's finds; the collection underneath it is this device's,
 * kept in localStorage, so tonight's eggs are still here next month.
 */
export default function EggsPanel({ found = [], onClose }) {
  const tonight = new Set(found.map((f) => f.egg));
  const ever = new Set([...foundEggs(), ...tonight]);

  return (
    <aside className="rules">
      <header className="rules__head">
        <h2>{T.eggs}</h2>
        <button className="rules__close" onClick={onClose} aria-label="Sulje">✕</button>
      </header>

      <p className="rules__count">
        {ever.size} / {EGG_IDS.length} {T.eggsFoundSuffix}
      </p>

      <dl className="rules__list">
        {EGG_IDS.map((id) => {
          const egg = EGGS[id];
          const isFound = ever.has(id);
          return (
            <div key={id} className={isFound ? '' : 'rules__locked'}>
              <dt>
                {isFound ? egg.title : '???'}
                {tonight.has(id) && <em className="rules__fresh"> · {T.eggsTonight}</em>}
              </dt>
              <dd>{isFound ? egg.blurb : TIERS[egg.tier]}</dd>
            </div>
          );
        })}
      </dl>
    </aside>
  );
}

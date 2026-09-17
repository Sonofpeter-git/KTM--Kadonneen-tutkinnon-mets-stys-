import { T, TOKEN_LABEL } from '../lib/strings.js';
import { EGGS, eggTier } from '../lib/eggs.js';

/** A brief flash over the board for the two card moments worth shouting about. */
export default function TokenFlash({ flash, guildsById, viewerGuildId, onDismiss }) {
  if (!flash) return null;

  if (flash.kind === 'MUUT_JUO') {
    return (
      <button className="stage__overlay flash-overlay" onClick={onDismiss}>
        <p className="flash-overlay__shout">{TOKEN_LABEL.muut_juo}</p>
      </button>
    );
  }

  if (flash.kind === 'UUDISTUS') {
    return (
      <button className="stage__overlay flash-overlay" onClick={onDismiss}>
        <p className="flash-overlay__shout">{TOKEN_LABEL.tutkintouudistus}</p>
      </button>
    );
  }

  const showTeam = flash.guildId !== viewerGuildId;

  // Eggs get the team colour and their tier underneath, so the size of the
  // find reads at a glance from across a room.
  if (flash.kind === 'EGG') {
    const egg = EGGS[flash.egg];
    return (
      <button
        className="stage__overlay flash-overlay flash-overlay--egg"
        style={{ '--team': guildsById[flash.guildId]?.color }}
        onClick={onDismiss}
      >
        <p className="flash-overlay__kicker">{eggTier(flash.egg)}</p>
        <p className="flash-overlay__shout">{egg?.title}</p>
        <p className="flash-overlay__teamname">{egg?.blurb}</p>
      </button>
    );
  }

  if (flash.kind === 'KANDI') {
    return (
      <button
        className="stage__overlay flash-overlay"
        style={{ '--team': guildsById[flash.guildId]?.color }}
        onClick={onDismiss}
      >
        <p className="flash-overlay__shout">{T.kandiReached}</p>
        {showTeam && (
          <p className="flash-overlay__teamname">{guildsById[flash.guildId]?.name}</p>
        )}
      </button>
    );
  }

  return (
    <button
      className="stage__overlay flash-overlay"
      style={{ '--team': guildsById[flash.guildId]?.color }}
      onClick={onDismiss}
    >
      <p className="flash-overlay__number numeric">
        {flash.op}<em>{T.credits}</em>
      </p>
      {showTeam && (
        <p className="flash-overlay__teamname">{guildsById[flash.guildId]?.name}</p>
      )}
    </button>
  );
}

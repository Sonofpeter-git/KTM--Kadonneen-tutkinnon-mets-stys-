import { T, TOKEN_LABEL } from '../lib/strings.js';

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

  const showTeam = flash.guildId !== viewerGuildId;
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

/**
 * Room codes that reskin the room.
 *
 * Ambient by design: the theme is on screen for the entire game, so unlike the
 * one-off eggs there is no moment to miss and nothing to announce. The hint
 * that these exist at all lives in the rules drawer, because nobody guesses
 * "KELA" unprompted.
 *
 * Purely cosmetic and purely client-side - the server has never heard of it,
 * and a themed room plays exactly like any other.
 */
export const ROOM_THEMES = {
  KELA: 'kela',
  WAPP: 'wappu',
  SAUN: 'sauna',
};

/** The theme class for a room code, or '' for the overwhelming majority. */
export function roomTheme(code) {
  return ROOM_THEMES[String(code ?? '').toUpperCase()] ?? '';
}

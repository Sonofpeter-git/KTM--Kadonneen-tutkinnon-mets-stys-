import { io } from 'socket.io-client';

/**
 * Connection and identity.
 *
 * The player id is generated once and kept in localStorage. It is the whole of
 * the reconnect story: rejoining with the same id gets your seat, guild, score
 * and position back, so a phone that locks or a browser that crashes mid-party
 * costs nothing.
 */

const KEY_ID = 'ktm:playerId';
const KEY_NAME = 'ktm:name';
const KEY_ROOM = 'ktm:room';

const read = (key) => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* private mode; not fatal */ }
};

export function playerId() {
  let id = read(KEY_ID);
  if (!id) {
    id = crypto.randomUUID();
    write(KEY_ID, id);
  }
  return id;
}

export const rememberedName = () => read(KEY_NAME);
export const rememberedRoom = () => read(KEY_ROOM);
export const remember = ({ name, room }) => {
  if (name != null) write(KEY_NAME, name);
  if (room != null) write(KEY_ROOM, room);
};

/**
 * Drop the remembered room, keeping the name and the player id.
 *
 * The id must survive: it is what a rejoin uses to reclaim a seat. Only the
 * room is forgotten, so the next reload asks which room to join instead of
 * silently dragging the player back into the last one.
 */
export const forget = () => {
  try { localStorage.removeItem(KEY_ROOM); } catch { /* private mode */ }
};

/**
 * In dev the Vite proxy puts the server on our own origin, so no URL is needed.
 * Point VITE_SERVER_URL at the server when the two are deployed apart.
 */
export function connect() {
  const url = import.meta.env?.VITE_SERVER_URL;
  return io(url || undefined, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
}

/** Promise wrapper over socket.io acknowledgements. */
export function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(Object.assign(new Error('offline'), { code: 'OFFLINE' }));
      return;
    }
    socket.emit(event, payload, (reply) => {
      if (reply?.ok) resolve(reply);
      else reject(Object.assign(new Error(reply?.message ?? event), { code: reply?.code }));
    });
  });
}

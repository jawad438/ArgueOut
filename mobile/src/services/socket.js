import {io} from 'socket.io-client';
import auth from '@react-native-firebase/auth';

const BASE = 'https://argueout.onrender.com';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(BASE, {autoConnect: false, transports: ['websocket']});
  }
  return socket;
}

export async function connectAndAuthenticate() {
  const s = getSocket();
  if (s.connected) return s;

  const user = auth().currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken();

  return new Promise((resolve, reject) => {
    s.once('connect', () => s.emit('authenticate', {idToken}));
    s.once('authenticated', () => resolve(s));
    s.once('connect_error', reject);
    s.connect();
  });
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect();
}

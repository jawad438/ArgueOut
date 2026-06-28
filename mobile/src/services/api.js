import auth from '@react-native-firebase/auth';

const BASE = 'https://argueout.onrender.com';

async function authHeaders() {
  const user = auth().currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();
  return {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'};
}

export async function getMe() {
  const res = await fetch(`${BASE}/api/me`, {headers: await authHeaders()});
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export async function lookupEmail(identifier) {
  const res = await fetch(`${BASE}/api/mobile/lookup`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({identifier}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'User not found');
  return data.email;
}

export async function registerUser(payload) {
  const res = await fetch(`${BASE}/api/mobile/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
}

export async function getSessionToken() {
  const res = await fetch(`${BASE}/api/mobile/session-token`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Session token failed');
  return data.customToken;
}

export async function updateProfileField(field, value) {
  const res = await fetch(`${BASE}/api/profile/${field}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({[field]: value}),
  });
  if (!res.ok) throw new Error('Update failed');
}

export async function updateCompass(x, y) {
  const res = await fetch(`${BASE}/api/profile/compass`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({x, y}),
  });
  if (!res.ok) throw new Error('Compass update failed');
}

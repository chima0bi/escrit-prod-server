// Verifies the ID token Google Identity Services already signed —
// this is the whole server-side job for "Sign in with Google" done
// this way. No Client Secret, no token exchange, no redirect dance:
// the browser talks to Google directly (see
// client/src/components/GoogleSignInButton.jsx), gets back a signed
// JWT, and hands it to us. All we do is check Google's signature and
// that the token was actually issued for *our* app (the `audience`
// check) — both of which only require the Client ID, which is public
// by design (it's already sitting in the client bundle).
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

let client = null;
function getClient() {
  if (!env.google.clientId) return null;
  if (!client) client = new OAuth2Client(env.google.clientId);
  return client;
}

export function isGoogleSignInConfigured() {
  return Boolean(env.google.clientId);
}

// Returns { googleId, email, name } for a valid token, or throws.
export async function verifyGoogleIdToken(idToken) {
  const c = getClient();
  if (!c) throw new AppError(503, 'Google Sign-In is not configured on this server');
  if (!idToken) throw new AppError(400, 'Missing Google ID token');

  let payload;
  try {
    const ticket = await c.verifyIdToken({ idToken, audience: env.google.clientId });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'Invalid Google sign-in token');
  }

  if (!payload?.email) throw new AppError(401, 'Google account has no email');
  if (payload.email_verified === false) {
    throw new AppError(401, 'Google account email is not verified');
  }

  return { googleId: payload.sub, email: payload.email, name: payload.name || null };
}

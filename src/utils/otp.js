// Shared helpers for the two "prove you have access to something"
// flows: email OTP verification and password-reset tokens. Both are
// stored hashed (never in plaintext) the same way a password is, so a
// database leak doesn't hand out working codes.
import crypto from 'crypto';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// A 6-digit numeric code is what people expect from "we emailed you a
// code" and is easy to type on a phone. Not cryptographically
// necessary to be long since it's rate-limited and short-lived.
export function generateOtp() {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  return { code, hash: sha256(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) };
}

export function verifyOtp(code, hash, expiresAt) {
  if (!hash || !expiresAt || expiresAt < new Date()) return false;
  return sha256(code) === hash;
}

// The reset token goes in a URL, so it's a long random hex string
// rather than something a person types — length matters here since
// it's the only thing standing between "clicked a link from their own
// inbox" and "reset someone else's password".
export function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) };
}

export function verifyResetToken(token, hash, expiresAt) {
  if (!hash || !expiresAt || expiresAt < new Date()) return false;
  return sha256(token) === hash;
}

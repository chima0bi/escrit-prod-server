// Seller authentication: short-lived access token read from the
// Authorization header, long-lived refresh token stored httpOnly so
// client-side JS never touches it (and therefore can't leak it to XSS).
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';
import { User } from '../models/User.js';
import { asyncHandler } from './asyncHandler.js';

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: userId }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl });
}

// Client (Vercel) and server (Render) live on different domains in
// production, so this cookie is cross-site from the browser's point of
// view. Cross-site cookies require SameSite=None + Secure — "lax"
// silently gets dropped by the browser in that setup, which is what
// used to make a seller look logged-in right after login (the access
// token is still in memory) but then unable to refresh/stay logged in
// after a reload. Locally (http, same-origin dev proxy) "lax" is used
// since None+Secure requires HTTPS.
export function refreshCookieOptions() {
  const crossSite = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, refreshCookieOptions());
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError(401, 'Missing access token');

  try {
    const payload = jwt.verify(token, env.jwt.accessSecret);
    req.sellerId = payload.sub;
    next();
  } catch {
    throw new AppError(401, 'Invalid or expired access token');
  }
}

// Internal admin surface (dispute resolution) must never be reachable
// by an arbitrary authenticated seller — that would let any seller
// resolve any *other* seller's dispute. Must run after requireAuth.
// Fails closed: an empty ADMIN_EMAILS list denies everyone rather than
// silently admitting everyone, which is what happened before this
// check existed even though the route comments claimed it did.
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  const user = await User.findById(req.sellerId);
  if (!user || !env.adminEmails.includes(user.email.toLowerCase())) {
    throw new AppError(403, 'Admin access only');
  }
  next();
});

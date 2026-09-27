// The buyer-facing routes are unauthenticated and reachable by anyone
// who has (or guesses) a link id, so they get a tighter limit than
// authenticated seller routes.
import rateLimit from 'express-rate-limit';

export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again shortly.' },
});

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  signAccessToken,
  signRefreshToken,
  setRefreshCookie,
  refreshCookieOptions,
  requireAuth,
} from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { verifyGoogleIdToken, isGoogleSignInConfigured } from '../services/googleAuth.js';
import { sendOtpEmail, sendPasswordResetEmail } from '../services/mailer.js';
import { generateOtp, verifyOtp, generateResetToken, verifyResetToken } from '../utils/otp.js';

export const authRouter = Router();

// Shared by every route below that logs a seller in: sign both tokens
// and hand back the same { accessToken, seller } shape, whichever path
// got them here (password, Google, freshly registered).
function issueSession(res, user) {
  const accessToken = signAccessToken(user.id);
  setRefreshCookie(res, signRefreshToken(user.id));
  return { accessToken, seller: user };
}

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  businessName: Joi.string().min(2).max(80).required(),
});

authRouter.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, businessName } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw new AppError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, businessName });

  // Fire off the verification OTP but never let a flaky email provider
  // block account creation — the "verify your email" banner (see
  // Layout.jsx) covers a seller who never got the email, and
  // /auth/resend-otp lets them ask again.
  await issueAndSendOtp(user).catch((err) => console.error('[auth] failed to send OTP', err));

  res.status(201).json(issueSession(res, user));
}));

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

authRouter.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  // A Google-only account has no passwordHash — bcrypt.compare would
  // throw on a null hash, so that has to be checked before comparing,
  // not just left to fail into the same generic error.
  const valid = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    if (user && !user.passwordHash) {
      throw new AppError(401, 'This account uses Google Sign-In — log in with Google instead');
    }
    throw new AppError(401, 'Invalid email or password');
  }

  res.json(issueSession(res, user));
}));

// --- Google Sign-In -------------------------------------------------
// The browser talks to Google directly via Google Identity Services
// and gets back a signed ID token; we only ever verify that token
// (services/googleAuth.js) — no Client Secret, no server-side
// redirect/exchange step. First time we see a Google email, the
// account is auto-created and the seller lands straight on the
// dashboard, same as the spec asks: no separate "register" step, no
// second login prompt.
authRouter.get('/google/config', (_req, res) => {
  res.json({ enabled: isGoogleSignInConfigured(), clientId: env.google.clientId });
});

const googleSchema = Joi.object({ idToken: Joi.string().required() });

authRouter.post('/google', authLimiter, validate(googleSchema), asyncHandler(async (req, res) => {
  const { googleId, email, name } = await verifyGoogleIdToken(req.body.idToken);

  let user = await User.findOne({ $or: [{ googleId }, { email }] });
  if (!user) {
    user = await User.create({
      email,
      googleId,
      businessName: name || email.split('@')[0],
      emailVerified: true, // Google already verified this address
    });
  } else if (!user.googleId) {
    // An existing email/password account signing in with Google for
    // the first time — link it rather than erroring or creating a
    // duplicate account for the same email.
    user.googleId = googleId;
    user.emailVerified = true;
    await user.save();
  }

  res.json(issueSession(res, user));
}));

// --- Email OTP verification ------------------------------------------
async function issueAndSendOtp(user) {
  const { code, hash, expiresAt } = generateOtp();
  user.otpCodeHash = hash;
  user.otpExpiresAt = expiresAt;
  await user.save();
  await sendOtpEmail(user.email, code);
}

authRouter.post('/resend-otp', authLimiter, requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.sellerId);
  if (!user) throw new AppError(404, 'Seller not found');
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

  await issueAndSendOtp(user);
  res.json({ ok: true });
}));

const verifyOtpSchema = Joi.object({ code: Joi.string().length(6).pattern(/^\d+$/).required() });

authRouter.post(
  '/verify-otp',
  authLimiter,
  requireAuth,
  validate(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.sellerId).select('+otpCodeHash +otpExpiresAt');
    if (!user) throw new AppError(404, 'Seller not found');

    if (!verifyOtp(req.body.code, user.otpCodeHash, user.otpExpiresAt)) {
      throw new AppError(400, 'That code is invalid or has expired');
    }

    user.emailVerified = true;
    user.otpCodeHash = null;
    user.otpExpiresAt = null;
    await user.save();
    res.json({ ok: true, seller: user });
  })
);

// --- Forgot / reset password ------------------------------------------
const forgotPasswordSchema = Joi.object({ email: Joi.string().email().required() });

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    // Always respond the same way whether or not the account exists —
    // otherwise this endpoint becomes a way to check which emails have
    // an Escrit account.
    if (user) {
      const { token, hash, expiresAt } = generateResetToken();
      user.resetTokenHash = hash;
      user.resetTokenExpiresAt = expiresAt;
      await user.save();
      const resetUrl = `${env.clientUrl}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
      await sendPasswordResetEmail(user.email, resetUrl).catch((err) =>
        console.error('[auth] failed to send reset email', err)
      );
    }
    res.json({ ok: true });
  })
);

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  token: Joi.string().required(),
  password: Joi.string().min(8).required(),
});

authRouter.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email, token, password } = req.body;
    const user = await User.findOne({ email }).select('+resetTokenHash +resetTokenExpiresAt');
    if (!user || !verifyResetToken(token, user.resetTokenHash, user.resetTokenExpiresAt)) {
      throw new AppError(400, 'This reset link is invalid or has expired');
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await user.save();
    res.json({ ok: true });
  })
);

authRouter.post('/refresh', (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new AppError(401, 'Missing refresh token');

  try {
    const payload = jwt.verify(token, env.jwt.refreshSecret);
    const accessToken = signAccessToken(payload.sub);
    res.json({ accessToken });
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token');
  }
});

authRouter.post('/logout', (_req, res) => {
  // clearCookie must be called with the SAME attributes the cookie was
  // set with (sameSite/secure included) or some browsers won't drop it.
  res.clearCookie('refreshToken', refreshCookieOptions());
  res.status(204).end();
});

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.sellerId);
  if (!user) throw new AppError(404, 'Seller not found');
  res.json({ seller: user });
}));

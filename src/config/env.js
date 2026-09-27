// Central place for reading and validating environment variables.
// Nothing else in the codebase should call `process.env` directly —
// that way missing config fails loudly, once, at startup.
import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 4000,
  // Comma-separated so a Vercel production domain and its preview
  // deployments can both be allowed, e.g.
  // "https://escrit.vercel.app,https://escrit-git-main-you.vercel.app"
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  mongodbUri: required("MONGODB_URI"),

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  },

  paystack: {
    secretKey: required("PAYSTACK_SECRET_KEY"),
    publicKey: required("PAYSTACK_PUBLIC_KEY"),
    baseUrl: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  },

  autoReleaseHours: Number(process.env.AUTO_RELEASE_HOURS) || 72,

  // Comma-separated seller emails allowed to resolve disputes / hit the
  // internal admin routes. Empty by default so a missing config fails
  // *closed* (403 on every admin route) rather than silently letting
  // any authenticated seller resolve any other seller's dispute.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Google Sign-In only ever needs the Client ID on the server — it's
  // the public half of the credential pair (the same value is also
  // sent to the browser) and is used purely as the expected
  // "audience" when verifying the ID token Google already signed.
  // There is no Client Secret anywhere in this flow: that's only
  // needed for the server-side "exchange a code for tokens" OAuth
  // dance, which this app doesn't do. Optional (not `required()`) so
  // the app still boots with Google Sign-In simply disabled until
  // it's set.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
  },

  // SMTP (Gmail), for OTP + password-reset emails. Also optional at
  // boot — see services/mailer.js, which falls back to logging the
  // email to the console in development so the flow is still
  // testable without credentials configured.
  //
  // SMTP_PASS must be a 16-character Google *App Password*, not the
  // real account password — Gmail rejects normal-password SMTP
  // logins outright. Generate one at
  // https://myaccount.google.com/apppasswords (requires 2-Step
  // Verification to be turned on first).
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    fromAddress: process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER || null,
  },

  // Where the client is hosted — used to build the links inside
  // verification / password-reset emails (e.g.
  // `${clientUrl}/reset-password?token=...`). Falls back to the first
  // configured CORS origin (see clientOrigins above) so a
  // single-origin deployment doesn't need to set this separately.
  clientUrl:
    process.env.CLIENT_URL ||
    (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0].trim(),
};

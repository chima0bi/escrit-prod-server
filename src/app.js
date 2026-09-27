import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { applyTrustProxy } from './config/trustProxy.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { enforceHttps, hstsHeader } from './middleware/enforceHttps.js';

import { authRouter } from './routes/auth.js';
import { sellerRouter } from './routes/seller.js';
import { linksRouter } from './routes/links.js';
import { publicRouter } from './routes/public.js';
import { webhooksRouter } from './routes/webhooks.js';
import { adminRouter } from './routes/admin.js';

export function createApp() {
  const app = express();

  applyTrustProxy(app);
  app.use(enforceHttps);
  app.use(hstsHeader);
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header (server-to-server, curl, the Paystack
        // webhook) — allow. Otherwise it must be one of the
        // configured client origins.
        if (!origin || env.clientOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(cookieParser());

  // The Paystack webhook needs the raw body for signature verification,
  // so it's mounted BEFORE the global JSON body parser, with its own
  // raw parser scoped to just that route.
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/seller', sellerRouter);
  app.use('/api/links', linksRouter);
  app.use('/api/r', publicRouter); // buyer-facing, no auth
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

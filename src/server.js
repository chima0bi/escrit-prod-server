import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { startAutoReleaseJob } from './services/autoRelease.js';

// Defense-in-depth: every Express route is now wrapped in asyncHandler
// (see middleware/asyncHandler.js), so a thrown error there always
// reaches errorHandler instead of becoming an unhandled rejection. But
// a handful of things run outside the request/response cycle — most
// notably the cron sweep in autoRelease.js — where a stray rejection
// would otherwise still crash the whole process silently (and, under
// `node --watch`, take down every unrelated in-flight request with
// it). Log loudly and keep running rather than exit, since losing the
// whole server over one bad cron tick is worse than one noisy log
// line.
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection', err);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception', err);
});

async function main() {
  await connectDB();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] listening on :${env.port} (${env.nodeEnv})`);
  });

  startAutoReleaseJob();
}

main().catch((err) => {
  console.error('[server] fatal startup error', err);
  process.exit(1);
});

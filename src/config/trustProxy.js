// Render/Vercel/most PaaS hosts sit behind a reverse proxy. Without
// `trust proxy`, Express sees the proxy's IP for every request, which
// silently breaks rate limiting and any IP-based logic. This is a
// project-wide non-negotiable, not a nice-to-have.
export function applyTrustProxy(app) {
  app.set('trust proxy', 1);
}

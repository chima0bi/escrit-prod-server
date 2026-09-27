// Render (and most PaaS hosts) terminate TLS at the load balancer and
// hand the app plain HTTP, setting `x-forwarded-proto` to say what the
// original request actually was. `trust proxy` (see config/trustProxy.js)
// is what makes `req.secure` reflect that correctly instead of always
// reading `false`. Only ever redirects in production — local dev over
// plain http would otherwise get bounced into a loop, since there's no
// TLS to forward from.
import { env } from '../config/env.js';

export function enforceHttps(req, res, next) {
  if (env.nodeEnv !== 'production' || req.secure) {
    return next();
  }
  // The Paystack webhook is server-to-server and always already HTTPS
  // in practice, but redirecting a POST would silently turn it into a
  // GET on most clients and drop the (signed) body — never redirect
  // it, just let a genuinely-plain-HTTP call fail on its own.
  if (req.path.startsWith('/api/webhooks')) return next();

  return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
}

// Sent on every response once we know the connection really is (or, in
// dev, is standing in for) HTTPS — tells the browser to skip HTTP
// entirely for this host for the next year, including subdomains.
// Harmless to send in dev too since it only takes effect once a
// browser has actually loaded the page over HTTPS at least once.
export function hstsHeader(_req, res, next) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
}

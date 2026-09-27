// One place that turns any thrown error into a consistent JSON shape.
// Route handlers should just `throw` or call `next(err)` — no ad-hoc
// try/catch response formatting scattered around the codebase.
export class AppError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) {
    // Only log unexpected errors loudly — expected 4xx AppErrors are
    // normal control flow, not incidents.
    console.error('[error]', err);
  }
  res.status(statusCode).json({
    error: err.message || 'Something went wrong',
    ...(err.details ? { details: err.details } : {}),
  });
}

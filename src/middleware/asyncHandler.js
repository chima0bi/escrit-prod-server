// Express 4 does not catch a rejected promise returned by an `async`
// route handler or middleware — it just becomes an unhandled
// rejection. In this codebase every "expected" error (invalid OTP, no
// bank account on file, seller not found, ...) is signaled by
// `throw new AppError(...)` from inside an async function, so without
// this wrapper NONE of those ever reach errorHandler: the promise
// rejects, nothing calls `next(err)`, the request hangs, and — because
// nothing here installs an `unhandledRejection` listener — Node's
// default behavior is to crash the whole process. `npm run dev` runs
// under `node --watch`, so the process then silently restarts, and
// every *other* in-flight request (on totally unrelated routes) fails
// with a generic 500 from the dev proxy until it's back up.
//
// Wrap every async route handler / middleware with this so a thrown
// error — expected or not — always reaches `errorHandler` instead.
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

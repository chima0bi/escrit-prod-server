import crypto from 'node:crypto';

// Short, URL-safe, collision-resistant enough for a hackathon's scale.
export function generateReference(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

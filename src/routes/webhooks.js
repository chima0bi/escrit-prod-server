// The single most security-critical file in the app. This is the only
// code path allowed to move a link from CREATED to PAID_HELD — i.e.
// the only thing that can make the system believe money has arrived.
// Everything here follows the Paystack-recommended pattern: verify
// the HMAC signature against the raw request body, and treat repeat
// deliveries as safe no-ops (markPaidAndHeld already checks status
// before acting, so a re-delivered event just returns early).
import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Transaction } from '../models/Transaction.js';
import { markPaidAndHeld } from '../services/escrow.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const webhooksRouter = Router();

// NOTE: this route must be mounted with `express.raw()` (see app.js) —
// signature verification needs the exact raw bytes Paystack sent, not
// a re-serialized JSON object, or valid signatures will fail to match.
webhooksRouter.post('/paystack', asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto
    .createHmac('sha512', env.paystack.secretKey)
    .update(req.body) // raw Buffer
    .digest('hex');

  if (!signature || signature !== expected) {
    console.warn('[webhook] rejected — signature mismatch');
    return res.status(401).end();
  }

  const event = JSON.parse(req.body.toString('utf8'));

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    const tx = await Transaction.findOne({ paystackReference: reference });
    if (tx) {
      await markPaidAndHeld(tx);
      console.log(`[webhook] transaction ${tx._id} marked PAID_HELD`);
    } else {
      console.warn(`[webhook] no transaction found for reference ${reference}`);
    }
  }

  // Always 200 quickly once verified — Paystack retries on non-2xx,
  // and we've already done the only thing that matters.
  res.status(200).end();
}));

// Minimal internal surface for the MVP's manual dispute resolution
// (see PRD.md - automated arbitration is explicitly out of scope).
// Gated by requireAuth + requireAdmin (an ADMIN_EMAILS allowlist) -
// so only sellers explicitly configured as admins can see or touch
// another seller's dispute.
import { Router } from 'express';
import Joi from 'joi';
import { Transaction, TX_STATUS } from '../models/Transaction.js';
import { Link } from '../models/Link.js';
import { User } from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { resolveDispute } from '../services/escrow.js';
import { runAutoReleaseSweepNow } from '../services/autoRelease.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

// Previously missing entirely: the only way to resolve a dispute was
// POST /disputes/:id/resolve, but nothing surfaced *which*
// transactions were disputed in the first place - a disputed one was
// a dead end with no UI anywhere in the product. This is what the
// admin dispute dashboard reads.
adminRouter.get('/disputes', asyncHandler(async (_req, res) => {
  const transactions = await Transaction.find({ status: TX_STATUS.DISPUTED }).sort({ disputeRaisedAt: 1 });

  const linkIds = [...new Set(transactions.map((t) => String(t.linkId)))];
  const links = await Link.find({ _id: { $in: linkIds } });
  const linkById = Object.fromEntries(links.map((l) => [String(l._id), l]));

  const sellerIds = [...new Set(links.map((l) => String(l.sellerId)))];
  const sellers = await User.find({ _id: { $in: sellerIds } }).select('email businessName');
  const sellerById = Object.fromEntries(sellers.map((s) => [String(s._id), s]));

  res.json({
    disputes: transactions.map((tx) => {
      const link = linkById[String(tx.linkId)] || null;
      return {
        transaction: tx,
        link,
        seller: link ? sellerById[String(link.sellerId)] || null : null,
      };
    }),
  });
}));

const resolveSchema = Joi.object({
  outcome: Joi.string().valid('release', 'refund').required(),
  // Required, not optional: the buyer and seller both see this
  // verbatim on their own order views (see resolveDispute's comment),
  // so every resolution carries a stated reason instead of just a
  // status flip nobody outside the admin ever explained.
  note: Joi.string().trim().min(10).max(500).required(),
});

adminRouter.post('/disputes/:id/resolve', validate(resolveSchema), asyncHandler(async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (!tx) throw new AppError(404, 'Transaction not found');

  const updated = await resolveDispute(tx, req.body.outcome, req.body.note);
  res.json({ transaction: updated });
}));

// Demo convenience: trigger the auto-release sweep immediately instead
// of waiting for the real 72-hour window during judging.
adminRouter.post('/run-auto-release', asyncHandler(async (_req, res) => {
  await runAutoReleaseSweepNow();
  res.status(204).end();
}));

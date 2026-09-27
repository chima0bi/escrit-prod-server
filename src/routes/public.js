// Everything here is reachable with no login — this is the buyer's
// entire experience of the product. Kept deliberately small: show the
// item and the seller's verified name, take a payment, and later let
// the buyer confirm or dispute. Nothing here ever writes an escrow
// status directly — that's the escrow service's job, so the rules in
// ARCHITECTURE.md can't be bypassed by a route taking a shortcut.
//
// A Link is the reusable, always-there product page — many buyers can
// be mid-checkout against it at once. Each checkout gets its own
// Transaction, and everything past "initialize payment" (status,
// confirm, dispute) is scoped to that one Transaction, never to the
// Link as a whole.
import { Router } from 'express';
import Joi from 'joi';
import { Link } from '../models/Link.js';
import { Transaction, TX_STATUS } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { publicLimiter } from '../middleware/rateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { initializeTransaction } from '../services/paystack.js';
import { releaseOnBuyerConfirmation, raiseDispute, reconcileWithPaystack } from '../services/escrow.js';
import { generateReference } from '../utils/reference.js';
import { env } from '../config/env.js';

export const publicRouter = Router();
publicRouter.use(publicLimiter);

async function loadLink(req) {
  const link = await Link.findById(req.params.linkId);
  if (!link) throw new AppError(404, 'This payment link does not exist');
  return link;
}

async function loadTransaction(req) {
  const tx = await Transaction.findOne({ _id: req.params.txId, linkId: req.params.linkId });
  if (!tx) throw new AppError(404, 'This order does not exist');
  return tx;
}

// Buyer-facing view of the product itself: item details plus the
// seller's *verified* name only — never the raw account number. This
// never reflects any one buyer's payment status, because there can be
// several buyers checking out against the same link at once.
publicRouter.get('/:linkId', asyncHandler(async (req, res) => {
  const link = await loadLink(req);
  const seller = await User.findById(link.sellerId);

  res.json({
    link: {
      id: link.id,
      itemName: link.itemName,
      itemDescription: link.itemDescription,
      itemPhotoUrl: link.itemPhotoUrl,
      priceKobo: link.priceKobo,
      active: link.active,
    },
    seller: {
      businessName: seller.businessName,
      verifiedAccountName: seller.bankAccount?.resolvedAccountName ?? null,
    },
  });
}));

const checkoutSchema = Joi.object({
  email: Joi.string().email().required(),
  phone: Joi.string().allow('').default(''),
});

// Starts a brand-new Transaction against this Link. The Link itself
// never changes state here — it can go on accepting other checkouts
// from other buyers at the same time.
publicRouter.post('/:linkId/checkout', validate(checkoutSchema), asyncHandler(async (req, res) => {
  const link = await loadLink(req);
  if (!link.active) {
    throw new AppError(409, 'This link is no longer accepting payment');
  }

  const tx = await Transaction.create({
    linkId: link._id,
    buyerEmail: req.body.email,
    buyerPhone: req.body.phone || null,
  });

  const reference = generateReference('escrit');
  const paystackTx = await initializeTransaction({
    email: req.body.email,
    amountKobo: link.priceKobo,
    reference,
    callbackUrl: `${env.clientOrigins[0]}/r/${link.id}/t/${tx.id}/result`,
    metadata: { linkId: link.id, transactionId: tx.id },
  });

  tx.paystackReference = reference;
  await tx.save();

  res.json({ authorizationUrl: paystackTx.authorization_url, reference, transactionId: tx.id });
}));

// The buyer's own order: this one Transaction's status, plus enough
// of the Link's item info to render the same "what did I buy" context
// as the product page. This is what the buyer's browser polls after
// paying, and what the result page and confirm/dispute actions work
// against.
publicRouter.get('/:linkId/t/:txId', asyncHandler(async (req, res) => {
  const link = await loadLink(req);
  let tx = await loadTransaction(req);
  tx = await reconcileWithPaystack(tx);
  const seller = await User.findById(link.sellerId);

  res.json({
    link: {
      id: link.id,
      itemName: link.itemName,
      itemDescription: link.itemDescription,
      itemPhotoUrl: link.itemPhotoUrl,
      priceKobo: link.priceKobo,
    },
    seller: {
      businessName: seller.businessName,
      verifiedAccountName: seller.bankAccount?.resolvedAccountName ?? null,
    },
    transaction: tx,
  });
}));

publicRouter.post('/:linkId/t/:txId/confirm-receipt', asyncHandler(async (req, res) => {
  const tx = await loadTransaction(req);
  const updated = await releaseOnBuyerConfirmation(tx);
  res.json({ transaction: updated });
}));

const disputeSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required(),
});

publicRouter.post('/:linkId/t/:txId/dispute', validate(disputeSchema), asyncHandler(async (req, res) => {
  const tx = await loadTransaction(req);
  const updated = await raiseDispute(tx, req.body.reason);
  res.json({ transaction: updated });
}));

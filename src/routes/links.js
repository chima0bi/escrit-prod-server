import { Router } from 'express';
import Joi from 'joi';
import { Link } from '../models/Link.js';
import { Transaction, TX_STATUS } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reconcileWithPaystack } from '../services/escrow.js';

export const linksRouter = Router();
linksRouter.use(requireAuth);

const createLinkSchema = Joi.object({
  itemName: Joi.string().min(2).max(120).required(),
  itemDescription: Joi.string().max(1000).allow('').default(''),
  itemPhotoUrl: Joi.string().uri().allow(null).default(null),
  priceNaira: Joi.number().min(100).required(), // collected in naira, stored in kobo
});

// Creating a Link never creates a Transaction — a Link can sit with
// zero buyers indefinitely. A Transaction only comes into being when
// someone actually starts checkout on the buyer-facing page.
linksRouter.post('/', validate(createLinkSchema), asyncHandler(async (req, res) => {
  const seller = await User.findById(req.sellerId);
  if (!seller?.bankAccount) {
    // Enforced here, not just in the UI — a link can't go live for a
    // seller we have no way to pay out.
    throw new AppError(422, 'Add a verified bank account before creating a payment link');
  }

  const { itemName, itemDescription, itemPhotoUrl, priceNaira } = req.body;
  const link = await Link.create({
    sellerId: seller.id,
    itemName,
    itemDescription,
    itemPhotoUrl,
    priceKobo: Math.round(priceNaira * 100),
  });

  res.status(201).json({ link });
}));

// A count per status, keyed the same way the client's StatusBadge
// vocabulary already is, so the dashboard list can show "2 held, 1
// disputed" at a glance without shipping every transaction down.
function emptyCounts() {
  return Object.fromEntries(Object.values(TX_STATUS).map((s) => [s, 0]));
}

linksRouter.get('/', asyncHandler(async (req, res) => {
  const links = await Link.find({ sellerId: req.sellerId }).sort({ createdAt: -1 });
  const linkIds = links.map((l) => l._id);

  // Same self-healing reconcile the buyer's route does (see
  // escrow.js) — a link the seller is watching shouldn't stay stuck
  // showing a stale "awaiting payment" transaction just because this
  // particular list route isn't the one the buyer happens to be
  // polling. Only the still-open (CREATED) transactions ever need it.
  const pending = await Transaction.find({ linkId: { $in: linkIds }, status: TX_STATUS.CREATED });
  await Promise.all(pending.map(reconcileWithPaystack));

  const counts = await Transaction.aggregate([
    { $match: { linkId: { $in: linkIds } } },
    { $group: { _id: { linkId: '$linkId', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const countsByLink = {};
  for (const { _id, count } of counts) {
    const key = String(_id.linkId);
    countsByLink[key] = countsByLink[key] || emptyCounts();
    countsByLink[key][_id.status] = count;
  }

  res.json({
    links: links.map((link) => ({
      link,
      transactionCounts: countsByLink[String(link._id)] || emptyCounts(),
    })),
  });
}));

linksRouter.get('/:id', asyncHandler(async (req, res) => {
  const link = await Link.findOne({ _id: req.params.id, sellerId: req.sellerId });
  if (!link) throw new AppError(404, 'Link not found');

  const transactions = await Transaction.find({ linkId: link._id }).sort({ createdAt: -1 });
  const reconciled = await Promise.all(
    transactions.map((tx) => (tx.status === TX_STATUS.CREATED ? reconcileWithPaystack(tx) : tx))
  );

  res.json({ link, transactions: reconciled });
}));

const updateLinkSchema = Joi.object({
  active: Joi.boolean().required(),
});

// The only lifecycle change a Link itself has: turning it off stops
// new checkouts, but any Transaction already open against it keeps
// resolving normally (held, released, disputed) — see Link.js.
linksRouter.patch('/:id', validate(updateLinkSchema), asyncHandler(async (req, res) => {
  const link = await Link.findOne({ _id: req.params.id, sellerId: req.sellerId });
  if (!link) throw new AppError(404, 'Link not found');

  link.active = req.body.active;
  await link.save();
  res.json({ link });
}));

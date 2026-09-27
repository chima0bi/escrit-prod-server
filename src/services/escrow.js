// The escrow state machine. This is the module the whole product's
// trust story depends on: a transaction's status only ever moves
// forward through one of the transitions below, and every transition
// that releases or refunds money makes a real Paystack call before
// the status is allowed to change. If the Paystack call fails, the
// status does not change — we'd rather show "still held" than lie
// about a payout that didn't happen.
//
// Everything here operates on a Transaction (one buyer's checkout),
// never on a Link directly — a Link has no escrow status of its own,
// it just owns however many Transactions have been opened against it.
import { env } from '../config/env.js';
import { Transaction, TX_STATUS } from '../models/Transaction.js';
import { Link } from '../models/Link.js';
import { User } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import * as paystack from './paystack.js';

/**
 * Called only from the webhook handler, only after signature
 * verification, only for a Paystack event that reports success.
 * Idempotent: calling this twice for the same transaction is a no-op
 * the second time.
 */
export async function markPaidAndHeld(tx) {
  if (tx.status !== TX_STATUS.CREATED) return tx; // already processed

  tx.status = TX_STATUS.PAID_HELD;
  tx.paidAt = new Date();
  tx.autoReleaseAt = new Date(Date.now() + env.autoReleaseHours * 60 * 60 * 1000);
  await tx.save();
  return tx;
}

/**
 * The webhook is the real source of truth for PAID_HELD (see
 * webhooks.js) — this never sets that status itself, it only asks
 * Paystack directly and, if Paystack confirms success, hands off to
 * the exact same markPaidAndHeld the webhook uses. The webhook is a
 * separate, best-effort delivery from Paystack: in local dev with no
 * public tunnel it can never arrive at all, and even in production it
 * can occasionally lag. Both the buyer's and seller's views poll their
 * status routes every few seconds, so calling this from those routes
 * means a stuck "Awaiting payment" self-heals on the next poll instead
 * of depending on the webhook specifically.
 */
export async function reconcileWithPaystack(tx) {
  if (tx.status !== TX_STATUS.CREATED || !tx.paystackReference) return tx;
  try {
    const verified = await paystack.verifyTransaction(tx.paystackReference);
    if (verified.status === 'success') {
      return await markPaidAndHeld(tx);
    }
  } catch (err) {
    // Paystack unreachable, reference not found yet, etc. — leave the
    // transaction as-is; the next poll (or the webhook, if it lands
    // first) will try again. Never surfaced to the caller as an error.
    console.warn(`[reconcile] verify failed for ${tx.id}: ${err.message}`);
  }
  return tx;
}

async function payOutToSeller(tx, reason) {
  const link = await Link.findById(tx.linkId);
  if (!link) throw new AppError(500, 'This transaction has no associated payment link');

  const seller = await User.findById(link.sellerId);
  if (!seller?.bankAccount?.paystackRecipientCode) {
    throw new AppError(500, 'Seller has no payout destination on file');
  }

  const transfer = await paystack.initiateTransfer({
    amountKobo: link.priceKobo,
    recipientCode: seller.bankAccount.paystackRecipientCode,
    reason,
    reference: `escrit-payout-${tx._id}`,
  });

  tx.payoutLog.push({ action: 'transfer_initiated', detail: transfer });
  tx.releasedAt = new Date();
  await tx.save();
  return transfer;
}

/**
 * Buyer confirms receipt. Only legal while funds are held and no
 * dispute is open.
 */
export async function releaseOnBuyerConfirmation(tx) {
  if (tx.status !== TX_STATUS.PAID_HELD) {
    throw new AppError(409, `Cannot release a transaction in status ${tx.status}`);
  }
  await payOutToSeller(tx, 'Escrit: buyer confirmed receipt');
  tx.status = TX_STATUS.RELEASED;
  await tx.save();
  return tx;
}

/**
 * The 72-hour (configurable) safety valve: if the buyer never responds,
 * the seller still gets paid. Prevents buyers from being able to
 * indefinitely freeze a seller's money just by going silent.
 */
export async function releaseOnAutoTimer(tx) {
  if (tx.status !== TX_STATUS.PAID_HELD) return tx;
  await payOutToSeller(tx, 'Escrit: auto-released after window with no dispute');
  tx.status = TX_STATUS.RELEASED;
  await tx.save();
  return tx;
}

/**
 * Buyer raises a dispute. Freezes the auto-release — the background
 * job skips any transaction that is not PAID_HELD, so this alone is
 * enough to stop the clock.
 */
export async function raiseDispute(tx, reason) {
  if (tx.status !== TX_STATUS.PAID_HELD) {
    throw new AppError(409, `Cannot dispute a transaction in status ${tx.status}`);
  }
  tx.status = TX_STATUS.DISPUTED;
  tx.disputeReason = reason;
  tx.disputeRaisedAt = new Date();
  await tx.save();
  return tx;
}

/**
 * Manual dispute resolution (MVP: an internal admin action, not an
 * automated arbitration system — see PRD.md for what's deliberately
 * out of scope). `note` is the admin's plain-language reason for the
 * outcome — required by the admin route (see routes/admin.js) so a
 * resolution is never just a silent status flip. It's stored on the
 * transaction itself, which both the buyer's and seller's own views
 * already read (public.js / links.js), so the reasoning is visible to
 * both sides without a separate "audit log" endpoint to keep in sync.
 */
export async function resolveDispute(tx, outcome, note) {
  if (tx.status !== TX_STATUS.DISPUTED) {
    throw new AppError(409, `Cannot resolve a transaction in status ${tx.status}`);
  }

  if (outcome === 'release') {
    await payOutToSeller(tx, 'Escrit: dispute resolved in seller favor');
    tx.status = TX_STATUS.RESOLVED_RELEASED;
  } else if (outcome === 'refund') {
    const link = await Link.findById(tx.linkId);
    const refund = await paystack.refundTransaction({
      reference: tx.paystackReference,
      amountKobo: link?.priceKobo,
    });
    tx.payoutLog.push({ action: 'refund_issued', detail: refund });
    tx.status = TX_STATUS.RESOLVED_REFUNDED;
  } else {
    throw new AppError(400, 'outcome must be "release" or "refund"');
  }

  tx.resolutionNote = note;
  tx.resolvedAt = new Date();
  await tx.save();
  return tx;
}

export { Transaction, TX_STATUS };

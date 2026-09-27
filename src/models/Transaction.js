// One buyer's checkout against a Link. This is where the escrow state
// machine actually lives (see ARCHITECTURE.md) — treat `status` as
// append-only forward motion, never write it from a client value. A
// single Link can have many Transactions open against it at once
// (different buyers, or the same buyer retrying), each tracked and
// resolved completely independently of the others.
import mongoose from 'mongoose';

export const TX_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PAID_HELD: 'PAID_HELD',
  RELEASED: 'RELEASED',
  DISPUTED: 'DISPUTED',
  RESOLVED_RELEASED: 'RESOLVED_RELEASED',
  RESOLVED_REFUNDED: 'RESOLVED_REFUNDED',
});

// Kept as an alias so any code (or notes) still referring to the old
// PaymentLink-era name keeps working — same values, same meaning.
export const LINK_STATUS = TX_STATUS;

const payoutLogEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, required: true }, // e.g. "transfer_initiated", "transfer_success", "refund_issued"
    detail: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Link', required: true, index: true },

    status: {
      type: String,
      enum: Object.values(TX_STATUS),
      default: TX_STATUS.CREATED,
      index: true,
    },

    // Paystack transaction reference, set at checkout initialization.
    paystackReference: { type: String, default: null, index: true },
    buyerEmail: { type: String, default: null },
    buyerPhone: { type: String, default: null },

    paidAt: { type: Date, default: null },
    autoReleaseAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },

    disputeReason: { type: String, default: null },
    disputeRaisedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    // Short plain-language explanation an admin gives for a dispute
    // outcome (release/refund). Shown back to both the buyer and the
    // seller — see PublicLinkPage.jsx / LinkDetail.jsx — so a
    // resolution is never just a status flip with no stated reason.
    // Never the admin's name/email: the "who" buyers and sellers see
    // is always "Escrit's dispute review team," not an individual, to
    // keep an admin's personal identity out of a public-facing record.
    resolutionNote: { type: String, default: null },

    payoutLog: { type: [payoutLogEntrySchema], default: [] },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model('Transaction', transactionSchema);

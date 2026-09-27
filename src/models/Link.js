// The shareable, reusable thing a seller creates: one item, one URL,
// no buyer and no escrow status of its own. A Link can be paid for
// repeatedly, by different buyers, concurrently — each checkout spins
// up its own Transaction (see Transaction.js), which is where all the
// escrow state machine lives. Never put buyer- or payment-specific
// fields on this model; if a field is per-purchase, it belongs on
// Transaction instead.
import mongoose from 'mongoose';

const linkSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    itemName: { type: String, required: true, trim: true },
    itemDescription: { type: String, trim: true, default: '' },
    itemPhotoUrl: { type: String, default: null },
    priceKobo: { type: Number, required: true, min: 10000 }, // ₦100 minimum, keeps test transfers sane

    // A seller can turn a Link off so it stops accepting new
    // checkouts, without touching any Transaction already in flight
    // against it — those keep resolving normally (held, released,
    // disputed, etc.) regardless of this flag. There is no separate
    // "archived" state for the MVP: active is the only lifecycle a
    // Link itself has.
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const Link = mongoose.model('Link', linkSchema);

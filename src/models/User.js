// The seller account. Buyers never get a User document — that's a
// deliberate product decision (zero-signup checkout), not an oversight.
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const bankAccountSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, required: true },
    bankCode: { type: String, required: true },
    bankName: { type: String, required: true },
    // Filled in by Paystack's "resolve account number" call — this is
    // the name we show buyers as proof the payout destination is real.
    resolvedAccountName: { type: String, required: true },
    // Returned by Paystack when we register a Transfer Recipient.
    // Required before any payout can be attempted.
    paystackRecipientCode: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Nullable: a Google-only account never sets a password, so this
    // can't be `required` the way it is for plain email/password
    // sign-up. authRouter enforces "must have one of passwordHash or
    // googleId" at the route level instead.
    passwordHash: { type: String, default: null },
    businessName: { type: String, required: true, trim: true },
    bankAccount: { type: bankAccountSchema, default: null },

    // Google Sign-In. `sparse: true` lets many documents have
    // googleId: null (every plain email/password account) without
    // tripping the unique index — a plain unique index would only
    // allow ONE null value total.
    googleId: { type: String, default: null, unique: true, sparse: true },

    // True immediately for a Google account (Google already verified
    // the email); false until OTP verification for a plain
    // email/password sign-up.
    emailVerified: { type: Boolean, default: false },
    otpCodeHash: { type: String, default: null, select: false },
    otpExpiresAt: { type: Date, default: null, select: false },

    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

// Never let a password hash, OTP hash, or reset token leak into an API
// response by accident. `isAdmin` isn't a stored field — it's derived
// from ADMIN_EMAILS here so the client can show/hide the disputes nav
// item (see Layout.jsx) without duplicating that list anywhere. This
// is purely a UI convenience: every actual admin route is still
// enforced server-side by requireAdmin regardless of what this says.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.otpCodeHash;
    delete ret.otpExpiresAt;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpiresAt;
    ret.isAdmin = env.adminEmails.includes(String(ret.email).toLowerCase());
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

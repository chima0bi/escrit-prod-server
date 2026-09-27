// Every call this app makes to Paystack lives in this one file. Keeping
// the HTTP integration in a single place means the rest of the app
// never touches fetch/axios directly for payments — easier to audit,
// easier to mock in tests, easier to swap providers later if needed.
import axios from 'axios';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const client = axios.create({
  baseURL: env.paystack.baseUrl,
  headers: {
    Authorization: `Bearer ${env.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },
});

// --- Checkout -------------------------------------------------------

/**
 * Starts a Paystack transaction. Returns the authorization_url the
 * buyer is redirected to (or used inline, client-side).
 */
export async function initializeTransaction({ email, amountKobo, reference, callbackUrl, metadata }) {
  const { data } = await client.post('/transaction/initialize', {
    email,
    amount: amountKobo,
    reference,
    callback_url: callbackUrl,
    metadata,
  });
  return data.data; // { authorization_url, access_code, reference }
}

/**
 * Server-side re-verification of a transaction. We call this as a
 * belt-and-braces check even though the webhook is the real source of
 * truth — it lets us confirm state on demand (e.g. if a webhook was
 * delayed) without ever trusting the client's own claim of success.
 */
export async function verifyTransaction(reference) {
  const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data; // includes status: 'success' | 'failed' | ...
}

// --- Payouts ----------------------------------------------------------

/**
 * Confirms a Nigerian bank account actually belongs to the name the
 * seller claims. This is the trust primitive the whole product rests
 * on: buyers see this resolved name before paying, so a fake account
 * number can't quietly collect their money.
 */
export async function resolveAccountNumber({ accountNumber, bankCode }) {
  try {
    const { data } = await client.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });
    return data.data; // { account_number, account_name }
  } catch (err) {
    // Paystack's own message here ("Could not resolve account name",
    // or a raw network/timeout failure) is either too technical or
    // too vague for the person typing digits into a form. Be direct
    // about what actually went wrong and what to do about it, instead
    // of surfacing "Request failed with status code 422" or a bare
    // "Failed to fetch".
    //
    // 429 is its own case: it means Paystack refused to even attempt
    // the lookup (test-mode daily resolve cap, or a genuine rate
    // limit) — not that the account doesn't exist. Telling the user
    // to "double-check the account number" here would be actively
    // wrong, so it gets a distinct message.
    if (err.response?.status === 429) {
      throw new AppError(
        429,
        "We're temporarily unable to verify bank accounts right now. Please try again in a little while."
      );
    }
    if (err.response) {
      throw new AppError(
        422,
        "We couldn't find any bank account with those details. Please double-check the account number and bank — and make sure it's really your own account."
      );
    }
    throw new AppError(
      503,
      "We couldn't reach your bank's verification service right now. Please try again in a moment."
    );
  }
}


/**
 * Registers a payout destination with Paystack. The returned
 * recipient_code is what we store and reuse for every future payout
 * to this seller — we never re-collect bank details per transaction.
 */
export async function createTransferRecipient({ accountNumber, bankCode, accountName }) {
  try {
    const { data } = await client.post('/transferrecipient', {
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    });
    return data.data; // { recipient_code, ... }
  } catch (err) {
    // Same reasoning as resolveAccountNumber above: this call used to
    // have no error handling at all, so any Paystack failure here
    // (bad bank_code, test-mode restrictions, a rejected recipient)
    // threw an uncaught error straight out of an async route handler
    // — which crashes the whole server (see asyncHandler.js) instead
    // of just failing this one request.
    if (err.response) {
      throw new AppError(
        422,
        "We verified the account, but couldn't register it for payouts. Please double-check the bank and account number and try again."
      );
    }
    throw new AppError(
      503,
      "We couldn't reach the payout service right now. Please try again in a moment."
    );
  }
}

/**
 * Moves money out of the platform's Paystack balance to the seller.
 * Called only from the escrow service, only when a link's state
 * machine says a release is allowed — never directly from a route.
 */
export async function initiateTransfer({ amountKobo, recipientCode, reason, reference }) {
  const { data } = await client.post('/transfer', {
    source: 'balance',
    amount: amountKobo,
    recipient: recipientCode,
    reason,
    reference,
  });
  return data.data; // { transfer_code, status, ... }
}

/**
 * Refunds the buyer's original charge — used when a dispute resolves
 * in the buyer's favor.
 */
export async function refundTransaction({ reference, amountKobo }) {
  const { data } = await client.post('/refund', {
    transaction: reference,
    amount: amountKobo,
  });
  return data.data;
}

// --- List of banks (used by the seller's bank-account form) --------

export async function listBanks() {
  const { data } = await client.get('/bank', { params: { country: 'nigeria' } });
  return data.data; // [{ name, code, ... }]
}

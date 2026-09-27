import { Router } from 'express';
import Joi from 'joi';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { resolveAccountNumber, createTransferRecipient, listBanks } from '../services/paystack.js';

export const sellerRouter = Router();
sellerRouter.use(requireAuth);

sellerRouter.get('/banks', asyncHandler(async (_req, res) => {
  const banks = await listBanks();
  res.json({ banks });
}));

const bankAccountSchema = Joi.object({
  accountNumber: Joi.string().length(10).pattern(/^\d+$/).required(),
  bankCode: Joi.string().required(),
  bankName: Joi.string().required(),
});

// This is the step that makes payouts possible at all, and the step
// that produces the "verified account name" buyers see before paying.
// We resolve with Paystack first — we never trust a self-reported name.
sellerRouter.post('/bank-account', validate(bankAccountSchema), asyncHandler(async (req, res) => {
  const { accountNumber, bankCode, bankName } = req.body;

  const resolved = await resolveAccountNumber({ accountNumber, bankCode });
  const recipient = await createTransferRecipient({
    accountNumber,
    bankCode,
    accountName: resolved.account_name,
  });

  const user = await User.findByIdAndUpdate(
    req.sellerId,
    {
      bankAccount: {
        accountNumber,
        bankCode,
        bankName,
        resolvedAccountName: resolved.account_name,
        paystackRecipientCode: recipient.recipient_code,
      },
    },
    { new: true }
  );

  if (!user) throw new AppError(404, 'Seller not found');
  res.json({ seller: user });
}));

// Scheduled job: sweeps for transactions that have been sitting in
// PAID_HELD past their autoReleaseAt timestamp with no dispute raised,
// and releases them exactly the way a buyer confirmation would. Runs
// in-process via node-cron for the hackathon build; on a platform
// without long-running processes (pure serverless), this would move
// to a hosted cron hitting an internal endpoint instead — the logic
// itself doesn't change.
import cron from 'node-cron';
import { Transaction, TX_STATUS } from '../models/Transaction.js';
import { releaseOnAutoTimer } from './escrow.js';

async function sweep() {
  const due = await Transaction.find({
    status: TX_STATUS.PAID_HELD,
    autoReleaseAt: { $lte: new Date() },
  });

  for (const tx of due) {
    try {
      await releaseOnAutoTimer(tx);
      console.log(`[auto-release] released transaction ${tx._id}`);
    } catch (err) {
      // One failed payout should never stop the sweep from processing
      // the rest of the batch.
      console.error(`[auto-release] failed for transaction ${tx._id}:`, err.message);
    }
  }
}

export function startAutoReleaseJob() {
  // Every 5 minutes is frequent enough for a 72-hour window and cheap
  // enough not to matter for a hackathon-scale dataset.
  cron.schedule('*/5 * * * *', sweep);
  console.log('[auto-release] scheduled job started');
}

// Exported for the admin/testing route that lets you trigger a sweep
// on demand during the demo instead of waiting for the real timer.
export const runAutoReleaseSweepNow = sweep;

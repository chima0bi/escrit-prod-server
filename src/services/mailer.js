// Thin wrapper around Brevo's transactional email HTTP API for the two
// emails this app sends: an OTP to verify a new email address, and a
// password-reset link. Deliberately plain `fetch` rather than Brevo's
// SDK — this is one POST with a JSON body, not worth a dependency.
//
// This goes over HTTPS (api.brevo.com, port 443), not SMTP — Render's
// free tier blocks outbound SMTP ports (25/465/587) entirely, which is
// what killed the previous Gmail-SMTP setup. An HTTP API call is a
// normal outbound request like any other and isn't affected.
//
// If BREVO_API_KEY isn't set (e.g. running locally without it
// configured), both functions log the email to the console instead of
// sending — the flow stays fully testable, you just read the code/link
// from the server log rather than an inbox.
import { env } from "../config/env.js";

async function send({ to, subject, html, devFallbackLabel, devFallbackValue }) {
  if (!env.brevo.apiKey || !env.brevo.fromAddress) {
    console.warn(
      `[mailer] Brevo not configured (BREVO_API_KEY/BREVO_FROM_ADDRESS missing) — not sending "${subject}" to ${to}.\n` +
        `[mailer] ${devFallbackLabel}: ${devFallbackValue}`,
    );
    return;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": env.brevo.apiKey,
      },
      body: JSON.stringify({
        sender: { name: env.brevo.fromName, email: env.brevo.fromAddress },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      // Brevo's error body (e.g. "sender not verified", bad key,
      // over the free-plan daily cap) is the useful part — surface
      // it rather than just the status code.
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Brevo responded ${res.status}`);
    }
  } catch (err) {
    // Same reasoning as before: don't let a failed send break the
    // calling route (registration/resend shouldn't 500 just because
    // the email bounced) — log it and fall back to the console value
    // so the flow is still usable while you sort out Brevo.
    console.error(
      `[mailer] Brevo send failed for "${subject}" to ${to}:`,
      err.message,
    );
    console.warn(`[mailer] ${devFallbackLabel}: ${devFallbackValue}`);
  }
}

export async function sendOtpEmail(to, code) {
  await send({
    to,
    subject: "Verify your email — Escrit",
    html: `
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
      <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    `,
    devFallbackLabel: "OTP code",
    devFallbackValue: code,
  });
}

export async function sendPasswordResetEmail(to, resetUrl) {
  await send({
    to,
    subject: "Reset your password — Escrit",
    html: `
      <p>Someone requested a password reset for this account.</p>
      <p><a href="${resetUrl}">Click here to set a new password</a> (expires in 30 minutes).</p>
      <p>If you didn't request this, you can ignore this email — your password won't change.</p>
    `,
    devFallbackLabel: "Reset URL",
    devFallbackValue: resetUrl,
  });
}

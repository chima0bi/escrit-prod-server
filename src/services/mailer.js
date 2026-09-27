// Thin wrapper around Nodemailer/Gmail SMTP for the two transactional
// emails this app sends: an OTP to verify a new email address, and a
// password-reset link. If SMTP_USER/SMTP_PASS aren't set (e.g. running
// locally without them configured), both functions log the email to
// the console instead of sending — the flow stays fully testable, you
// just read the code/link from the server log rather than an inbox.
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transporter =
  env.smtp.user && env.smtp.pass
    ? nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.port === 465, // true for port 465 (SSL), false for 587 (STARTTLS)
        auth: { user: env.smtp.user, pass: env.smtp.pass },
      })
    : null;

async function send({ to, subject, html, devFallbackLabel, devFallbackValue }) {
  if (!transporter) {
    console.warn(
      `[mailer] SMTP not configured (SMTP_USER/SMTP_PASS missing) — not sending "${subject}" to ${to}.\n` +
        `[mailer] ${devFallbackLabel}: ${devFallbackValue}`,
    );
    return;
  }
  try {
    await transporter.sendMail({
      from: env.smtp.fromAddress,
      to,
      subject,
      html,
    });
  } catch (err) {
    // Unlike Resend, Nodemailer does throw on a rejected send (bad
    // app password, Gmail rate limit, etc) — but we still don't want
    // that to break the calling route (e.g. registration shouldn't
    // 500 just because the OTP email bounced), so it's caught and
    // logged here, with the same dev fallback so the flow is still
    // usable while you sort out the SMTP credentials.
    console.error(
      `[mailer] SMTP send failed for "${subject}" to ${to}:`,
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

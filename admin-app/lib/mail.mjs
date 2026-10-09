// Email sending through Brevo (https://www.brevo.com) — used for sign-in and password-reset links.
// Without BREVO_API_KEY the email options are hidden; in local mode emails are printed instead.
import { config } from './config.mjs';

// MAIL_FROM can be "Name <address>" or just "address".
function parseSender(from) {
  const match = String(from).match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return match ? { name: match[1].replace(/^"|"$/g, '') || undefined, email: match[2] } : { email: String(from).trim() };
}

export async function sendEmail({ to, subject, text, html }) {
  if (!config.mail.brevoApiKey) {
    if (config.backend === 'local') {
      console.log(`\n[email to ${to}] ${subject}\n${text}`);
      return;
    }
    throw Object.assign(new Error('Email sign-in is not set up on this server.'), { status: 503 });
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.mail.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: parseSender(config.mail.from), to: [{ email: to }], subject, htmlContent: html, textContent: text })
  });
  if (!response.ok) {
    console.error('Brevo error', response.status, await response.text());
    throw Object.assign(new Error('The email could not be sent. Please try again later.'), { status: 502 });
  }
}

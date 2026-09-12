import type { Env } from './types';

/**
 * Invio delle email tramite Resend.
 *
 * Senza `RESEND_API_KEY` configurata non si spedisce niente e il messaggio
 * finisce nel log: e' il comportamento voluto in sviluppo, dove `wrangler dev`
 * emula database e bucket ma non puo' emulare la posta. Il link si copia dal
 * terminale e il flusso si prova per intero senza un dominio verificato.
 */

async function send(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email non spedita: RESEND_API_KEY assente]\na: ${to}\n${subject}\n\n${text}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? 'The Masonry Archive <onboarding@resend.dev>',
      to,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    // Un errore di posta non deve far fallire la richiesta dell'utente, che ha
    // gia' fatto la sua parte: si registra e si va avanti.
    console.error('resend', response.status, await response.text());
  }
}

export async function sendMagicLink(
  env: Env,
  email: string,
  token: string,
): Promise<void> {
  const url = `${env.SITE_URL.replace(/\/$/, '')}/#/auth?token=${encodeURIComponent(token)}`;
  await send(
    env,
    email,
    'Your link to The Masonry Archive',
    `Open this link to sign in to The Masonry Archive:\n\n${url}\n\n` +
      `It works once and expires in 15 minutes.\n\n` +
      `If you did not ask for it, ignore this message — nothing was created.`,
  );
}

export async function sendDecision(
  env: Env,
  email: string,
  accepted: boolean,
  note: string,
): Promise<void> {
  await send(
    env,
    email,
    accepted
      ? 'Your photo was accepted into The Masonry Archive'
      : 'About your submission to The Masonry Archive',
    accepted
      ? `Your photo has been accepted and added to the archive as a record awaiting ` +
        `cataloguing. It becomes publicly visible once it has been catalogued and approved.` +
        (note ? `\n\nNote from the curator:\n${note}` : '')
      : `Your submission was not accepted.` +
        (note ? `\n\nReason:\n${note}` : '') +
        `\n\nYou are welcome to submit other photos.`,
  );
}

const { createHash } = require('node:crypto');
const ADMINS = ['madey.verpakken@gmail.com', 'sensebridge.official@gmail.com'];
const REPLY = 'sensebridge.official@gmail.com';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Separate credentials preserve the existing notification configuration.
async function send({ to, subject, text, eventId, legacy = false }) {
  const key = legacy ? process.env.RESEND_API_KEY : process.env.SB_RESEND_API_KEY;
  if (!key) return { sent: false, error: 'Brak konfiguracji poczty: ' + (legacy ? 'RESEND_API_KEY' : 'SB_RESEND_API_KEY') };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        'Idempotency-Key': 'sb-' + createHash('sha256').update(eventId).digest('hex') },
      body: JSON.stringify({ from: legacy ? 'Sense Bridge <onboarding@resend.dev>' : 'Sense Bridge <powiadomienia@sensebridge.app>',
        to, reply_to: REPLY, subject, text,
        html: '<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-line">' + escape(text) + '</div>' })
    });
    if (!response.ok) return { sent: false, error: 'Resend HTTP ' + response.status };
    return { sent: true, error: null };
  } catch (_) {
    return { sent: false, error: 'Nie udało się potwierdzić wysyłki wiadomości.' };
  }
}

exports.sendRequest = async data => {
  const legacy = !process.env.SB_RESEND_API_KEY;
  return send({ legacy, to: legacy ? [ADMINS[0]] : ADMINS,
    subject: data.repeated ? 'Ponowne zgłoszenie dostępu Sense Bridge' : 'Nowe zgłoszenie dostępu Sense Bridge',
    text: `Użytkownik prosi o dalszy dostęp do Sense Bridge.\nEmail: ${data.email}\nNumer prośby: ${data.requestCount || 1}\nKraj / język: ${data.requestCountry || 'UNKNOWN'} / ${data.requestLang || 'UNKNOWN'}\nZgłoszono: ${new Date(data.createdAt).toISOString()}\nRozpatrz zgłoszenie w panelu administratora.`,
    eventId: 'request|' + data.email + '|' + data.createdAt });
};

exports.sendActivation = async data => {
  const pl = String(data.lang || 'PL').toUpperCase().startsWith('PL');
  const details = data.plan === 'BONUS' ? (pl ? 'Przyznano 3 dodatkowe użycia.' : 'You have been granted 3 additional uses.')
    : data.plan === 'BETA' ? (pl ? 'Przyznano dostęp BETA bez daty wygaśnięcia.' : 'BETA access has been granted without an expiry date.')
    : (pl ? 'Przyznano dostęp w planie ' : 'Access granted for plan ') + data.plan + '.\n' +
      (pl ? 'Dostęp ważny do: ' : 'Access valid until: ') + new Date(data.expires).toISOString() + ' (UTC).';
  const eventId = 'activation|' + data.email + '|' + data.plan + '|' + data.createdAt;
  const legacy = !process.env.SB_RESEND_API_KEY;
  const [user, admin] = await Promise.all([
    send({ to: [data.email], subject: pl ? 'Sense Bridge — dostęp aktywowany' : 'Sense Bridge — access activated',
      text: (pl ? 'Twój dostęp do Sense Bridge został aktywowany.\n' : 'Your access to Sense Bridge has been activated.\n') + details +
        '\n\nhttps://sensebridge.app/app\n' + (pl ? 'W aplikacji użyj tego samego adresu e-mail. W razie pytań odpowiedz na tę wiadomość.' : 'Use the same email address in the app. If you have questions, reply to this email.'), eventId: eventId + '|user' }),
    send({ legacy, to: legacy ? [ADMINS[0]] : ADMINS, subject: 'Aktywacja dostępu Sense Bridge',
      text: `Aktywowano dostęp.\nEmail: ${data.email}\nPlan: ${data.plan}\n${details}\nAktywacja: ${new Date(data.createdAt).toISOString()}`, eventId: eventId + '|admin' })
  ]);
  return { sent: user.sent, error: user.error, adminEmailSent: admin.sent, adminEmailError: admin.error };
};

// src/services/salesmanago.js
import axios from 'axios';
import crypto from 'crypto';

const {
  SMANAGO_CLIENT_ID,
  SMANAGO_API_KEY,
  SMANAGO_API_SECRET,
  SMANAGO_OWNER_EMAIL,
} = process.env;

function buildAuthPayload(extra = {}) {
  const clientId = SMANAGO_CLIENT_ID;
  const apiKey = SMANAGO_API_KEY;
  const apiSecret = SMANAGO_API_SECRET;
  const owner = SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();
  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  return { clientId, apiKey, sha, requestTime, owner, ...extra };
}

export async function getNewsletterStatus(contactId) {
  try {
    const payload = buildAuthPayload({
      // 👈 ellos piden array de contactId
      contactId: [contactId],
    });

    const { data } = await axios.post(
      'https://app3.salesmanago.pl/api/contact/listById',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    const contact = data?.contacts?.[0];

    if (!contact) {
      console.warn('[SM][listById] contacto no encontrado', data);
      return { contactId, acceptsNewsletter: null, rawFlag: null, found: false };
    }

    // DEBUG fuerte para ver exactamente qué viene
    console.log(
      '[SM][listById] contacto:',
      JSON.stringify(contact, null, 2)
    );

    // 🔎 Intentamos varios nombres típicos del flag de opt-out
    const optOutEmail =
      contact?.details?.optOutEmail ??
      contact?.details?.optoutEmail ??
      contact?.optOutEmail ??
      contact?.optoutEmail ??
      null;

    let acceptsNewsletter = null;

    // Según lo que te han dicho:
    // true  => NO acepta news
    // false => SÍ acepta news
    if (typeof optOutEmail === 'boolean') {
      acceptsNewsletter = !optOutEmail;
    }

    return {
      contactId,
      acceptsNewsletter,
      rawFlag: optOutEmail, // para que lo veas en la respuesta
      found: true,
    };
  } catch (err) {
    console.error('[SM][listById] Error', err.response?.data || err.message);
    throw err;
  }
}

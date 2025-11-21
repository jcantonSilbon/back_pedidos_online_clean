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
  // contactId es el que recibimos de la query (?smclient=...)
  const payload = buildAuthPayload({
    contactId: [contactId],
  });

  const { data } = await axios.post(
    'https://app3.salesmanago.pl/api/contact/listById',
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );

  const contact = data?.contacts?.[0];

  // Ojo: usa el nombre exacto del campo que te han dicho (ej. "optoutEmail")
  const optOutEmail = contact?.details?.optoutEmail;
  const acceptsNewsletter = optOutEmail === false;

  return {
    contactId,
    acceptsNewsletter,
    raw: data,
  };
}

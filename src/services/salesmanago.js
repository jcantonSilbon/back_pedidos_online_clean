// src/services/salesmanago.js
import axios from 'axios';
import crypto from 'crypto';

const {
  SMANAGO_CLIENT_ID,
  SMANAGO_API_KEY,
  SMANAGO_API_SECRET,
  SMANAGO_OWNER_EMAIL,
} = process.env;

const SM_BASE_URL = 'https://app3.salesmanago.pl'; // o el que te hayan dado

function buildAuth(extra = {}) {
  const clientId = SMANAGO_CLIENT_ID;
  const apiKey = SMANAGO_API_KEY;
  const apiSecret = SMANAGO_API_SECRET;
  const owner = SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();
  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  return { clientId, apiKey, requestTime, sha, owner, ...extra };
}

export async function getNewsletterStatus(contactId) {
  // payload EXACTO que ellos piden
  const payload = buildAuth({
    contactId: [contactId],
  });

  const { data } = await axios.post(
    `${SM_BASE_URL}/api/contact/listById`,
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );

  const contact = data?.contacts?.[0] || null;

  // 🔍 intento genérico de encontrar el flag (por si cuela)
  let rawFlag = null;
  let acceptsNewsletter = null;

  if (contact && contact.details) {
    for (const [key, value] of Object.entries(contact.details)) {
      if (typeof value === 'boolean' && /news|opt|email/i.test(key)) {
        rawFlag = value; // true = NO acepta, false = SÍ acepta
        break;
      }
    }

    if (typeof rawFlag === 'boolean') {
      acceptsNewsletter = !rawFlag;
    }
  }

  // 👇 devolvemos TODO lo interesante para que lo veas en Postman
  return {
    contactId,
    acceptsNewsletter,   // lo que usaremos luego en Shopify
    rawFlag,             // el booleano que encontremos
    found: !!contact,
    rawContact: contact, // contacto de listById
    rawResponse: data,   // respuesta completa de Salesmanago
  };
}

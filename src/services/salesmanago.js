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

  // 🧠 NUEVO: usamos directamente el campo "optedOut"
  let optedOut = null;
  let acceptsNewsletter = null;

  if (contact) {
    // en tu JSON venía a nivel raíz: "optedOut": true
    if (typeof contact.optedOut === 'boolean') {
      optedOut = contact.optedOut;
    }
    // por si acaso en algún entorno viene anidado en details
    else if (contact.details && typeof contact.details.optedOut === 'boolean') {
      optedOut = contact.details.optedOut;
    }

    // optedOut = true  -> NO acepta news
    // optedOut = false -> SÍ acepta news
    if (typeof optedOut === 'boolean') {
      acceptsNewsletter = !optedOut;
    }
  }

  return {
    contactId,
    acceptsNewsletter, // 👉 true = SÍ, false = NO
    optedOut,          // el flag original de Salesmanago
    found: !!contact,
    rawContact: contact,
    rawResponse: data,
  };
}

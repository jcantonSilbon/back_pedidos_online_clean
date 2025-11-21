// src/services/salesmanago.js
import axios from 'axios';
import crypto from 'crypto';

const SM_CLIENT_ID = process.env.SMANAGO_CLIENT_ID;
const SM_API_KEY = process.env.SMANAGO_API_KEY;
const SM_API_SECRET = process.env.SMANAGO_API_SECRET;
const SM_OWNER = process.env.SMANAGO_OWNER_EMAIL;

// Puedes ponerlo en env si quieres: SMANAGO_LISTBYID_URL
const SM_LIST_BY_ID_URL =
  process.env.SMANAGO_LISTBYID_URL ||
  'https://app3.salesmanago.pl/api/contact/listById';

function buildSha() {
  return crypto
    .createHash('sha1')
    .update(SM_API_KEY + SM_CLIENT_ID + SM_API_SECRET)
    .digest('hex');
}

export async function getNewsletterStatus(contactId) {
  if (!contactId) {
    throw new Error('contactId vacío');
  }

  const requestTime = Date.now();
  const sha = buildSha();

  const payload = {
    clientId: SM_CLIENT_ID,
    apiKey: SM_API_KEY,
    requestTime,
    sha,
    owner: SM_OWNER,
    contactId: [contactId], // 👈 nos pasan un array con ese contactId/smclient
  };

  // Log sin apiKey/sha para que no se filtren credenciales
  console.log('[SM][listById] ▶️ Payload', JSON.stringify({
    ...payload,
    apiKey: '***',
    sha: '***',
  }));

  try {
    const { data } = await axios.post(SM_LIST_BY_ID_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    console.log('[SM][listById] raw response:', JSON.stringify(data, null, 2));

    // Depende un poco de cómo devuelva Salesmanago la estructura.
    // Normalmente algo tipo data.contacts[0] o similar.
    const contact =
      (Array.isArray(data?.contacts) && data.contacts[0]) ||
      data?.contact ||
      null;

    if (!contact) {
      console.warn('[SM][listById] ⚠️ Sin contacto para', contactId);
      return {
        contactId,
        acceptsNewsletter: null,
        rawFlag: null,
        found: false,
      };
    }

    // Aquí intentamos localizar el booleano. Hasta que lo veamos claro en logs,
    // miramos varios nombres típicos.
    const details = contact.details || contact.contactDetails || contact;

    const rawFlag =
      details?.newsletterOptOut ??
      details?.optOut ??
      details?.optout ??
      details?.newsletterOptin ??
      null;

    let acceptsNewsletter = null;

    // Según lo que te han dicho:
    // true  -> NO acepta news (opt-out)
    // false -> SÍ acepta news
    if (typeof rawFlag === 'boolean') {
      acceptsNewsletter = rawFlag === false;
    }

    const normalized = {
      contactId,
      acceptsNewsletter,
      rawFlag,
      found: true,
    };

    console.log('[SM][listById] normalized:', normalized);
    return normalized;
  } catch (err) {
    console.error('[SM][listById] ❌ error', err.response?.data || err.message);
    throw err;
  }
}

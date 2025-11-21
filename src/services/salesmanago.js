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

/**
 * Contacto por ID (lo que ya probaste en Postman -> listById)
 */
async function fetchContactById(contactId) {
  const payload = buildAuth({
    contactId: [contactId],
  });

  const { data } = await axios.post(
    `${SM_BASE_URL}/api/contact/listById`,
    payload,
    { headers: { 'Content-Type': 'application/json' } },
  );

  const contact = data?.contacts?.[0] || null;
  return { contact, rawResponse: data };
}

/**
 * Contacto por email (lo usaremos desde Shopify)
 * ⚠️ Si vuestro account manager os dice otro endpoint (p.e. getContactByEmailV2),
 * solo hay que cambiar la URL de abajo.
 */
async function fetchContactByEmail(email) {
  const payload = buildAuth({ email });

  const { data } = await axios.post(
    `${SM_BASE_URL}/api/contact/getByEmail`,
    payload,
    { headers: { 'Content-Type': 'application/json' } },
  );

  // según docs puede venir en data.contact o en data.contacts[0]
  const contact = data?.contact || data?.contacts?.[0] || null;
  return { contact, rawResponse: data };
}

/**
 * Devuelve si el contacto acepta newsletter o no.
 * - true  -> acepta newsletter
 * - false -> no acepta
 * - null  -> no se ha podido determinar
 */
export async function getNewsletterStatus({ contactId, email }) {
  if (!contactId && !email) {
    throw new Error('getNewsletterStatus: contactId o email requerido');
  }

  let info;

  if (contactId) {
    info = await fetchContactById(contactId);
  } else {
    info = await fetchContactByEmail(email);
  }

  const { contact, rawResponse } = info;

  if (!contact) {
    return {
      contactId: contactId || null,
      email: email || null,
      acceptsNewsletter: null,
      rawFlag: null,
      found: false,
      rawContact: null,
      rawResponse,
    };
  }

  // 👉 Flag que nos interesa: optedOut
  let rawFlag = null;

  if (typeof contact.optedOut === 'boolean') {
    rawFlag = contact.optedOut; // true = opt-out, false = opt-in
  } else if (contact.details) {
    // fallback paranoico por si en otro entorno lo metieran en "details"
    for (const [key, value] of Object.entries(contact.details)) {
      if (typeof value === 'boolean' && /optedout|newsletter|email/i.test(key)) {
        rawFlag = value;
        break;
      }
    }
  }

  // true  (optedOut)  -> NO acepta
  // false (no opt-out)-> SÍ acepta
  const acceptsNewsletter =
    typeof rawFlag === 'boolean' ? !rawFlag : null;

  return {
    contactId: contact.id || contactId || null,
    email: contact.email || email || null,
    acceptsNewsletter, // lo que usaremos en Shopify
    rawFlag,           // el booleano "optedOut"
    found: true,
    rawContact: contact,
    rawResponse,
  };
}

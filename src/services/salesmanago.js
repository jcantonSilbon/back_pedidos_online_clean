const axios = require("axios");
const crypto = require("crypto");

const API_KEY = process.env.SMANAGO_API_KEY;
const API_SECRET = process.env.SMANAGO_API_SECRET;
const CLIENT_ID = process.env.SMANAGO_CLIENT_ID;
const OWNER = process.env.SMANAGO_OWNER_EMAIL;
const API_URL = "https://xxx.salesmanago.com/api/contact/listById"; // <-- pon aquí el tuyo real

/**
 * Genera hash SHA1 requerido por Salesmanago
 */
function generateSha(requestTime) {
  return crypto
    .createHash("sha1")
    .update(API_KEY + CLIENT_ID + API_SECRET + requestTime)
    .digest("hex");
}

/**
 * Llama a Salesmanago para obtener info del contacto por contactId
 * Devuelve:
 *   {
 *     contactId: string,
 *     acceptsNewsletter: boolean
 *   }
 */
async function getNewsletterStatus(contactId) {
  if (!contactId) {
    throw new Error("contactId vacío");
  }

  const requestTime = Date.now();
  const sha = generateSha(requestTime);

  const payload = {
    clientId: CLIENT_ID,
    apiKey: API_KEY,
    requestTime,
    sha,
    owner: OWNER,
    contactId: [contactId]
  };

  try {
    const response = await axios.post(API_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    const raw = response.data;

    if (!raw || !raw.contacts || raw.contacts.length === 0) {
      throw new Error("Contacto no encontrado en Salesmanago");
    }

    const contact = raw.contacts[0];

    // OJO → Salesmanago usa:
    //   true  → NO acepta newsletter (opt-out)
    //   false → SÍ acepta newsletter (opt-in)
    const optOut = contact.details?.optOut;

    const normalized = {
      contactId,
      acceptsNewsletter: optOut === false, // false = acepta
    };

    return normalized;

  } catch (error) {
    console.error("[Salesmanago] Error:", error.response?.data || error.message);
    throw new Error("Error al consultar Salesmanago");
  }
}

module.exports = { getNewsletterStatus };

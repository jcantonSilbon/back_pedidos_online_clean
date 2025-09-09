// api/assign-profile.js
const SHOP_DOMAIN = process.env.SHIP_SHOP_DOMAIN || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN = process.env.SHIP_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
const API_VERSION = process.env.SHIP_API_VERSION || process.env.API_VERSION || '2025-01';
const FLOW_SECRET = process.env.SHIP_FLOW_SECRET || process.env.FLOW_WEBHOOK_SECRET;

// Si usas Node 18+ fetch es global. Si no, descomenta esta línea:
// import fetch from 'node-fetch';

async function adminGraphQL(query, variables = {}) {
  const resp = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADMIN_TOKEN },
    body: JSON.stringify({ query, variables })
  });
  const data = await resp.json();
  if (!resp.ok || data.errors) {
    const msg = JSON.stringify(data.errors || data, null, 2);
    throw new Error(`GraphQL error: ${msg}`);
  }
  return data.data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (FLOW_SECRET && req.headers['x-flow-secret'] !== FLOW_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const { variantId, profileId } = req.body || {};
  if (!variantId || !profileId) return res.status(400).json({ error: 'Missing variantId or profileId' });

  try {
    // 1) excluir por handle
    const qHandle = `
      query VariantHandle($id: ID!) {
        productVariant(id: $id) { id product { id handle title } }
      }
    `;
    const handleData = await adminGraphQL(qHandle, { id: variantId });
    const handle = handleData?.productVariant?.product?.handle || '';
    if (!handle) return res.status(400).json({ error: 'Could not resolve product handle for variant' });

    if (handle.toLowerCase().includes('second-life')) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'excluded_by_handle', handle });
    }

    // 2) asignar con esquema moderno
    const mutation = `
      mutation AssignOne($id: ID!, $assoc: [ID!], $dissoc: [ID!]) {
        deliveryProfileUpdate(
          id: $id,
          profile: { variantsToAssociate: $assoc, variantsToDissociate: $dissoc }
        ) {
          userErrors { field message }
        }
      }
    `;
    const data = await adminGraphQL(mutation, { id: profileId, assoc: [variantId], dissoc: [] });
    const userErrors = data?.deliveryProfileUpdate?.userErrors || [];

    const benign = userErrors.every(e =>
      /already|associated/i.test(String(e?.message || ''))
    );
    if (userErrors.length && !benign) {
      return res.status(400).json({ error: 'UserErrors', details: userErrors });
    }

    return res.status(200).json({ ok: true, handle });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

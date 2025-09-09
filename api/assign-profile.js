// Prioriza las SHIP_* y cae a las genéricas si no existen
const SHOP_DOMAIN  = process.env.SHIP_SHOP_DOMAIN  || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN  = process.env.SHIP_ADMIN_TOKEN  || process.env.ADMIN_TOKEN;
const API_VERSION  = process.env.SHIP_API_VERSION  || process.env.API_VERSION || '2025-01';
const FLOW_SECRET  = process.env.SHIP_FLOW_SECRET  || process.env.FLOW_WEBHOOK_SECRET;

async function adminGraphQL(query, variables = {}) {
  const resp = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // seguridad simple
  if (FLOW_SECRET && req.headers['x-flow-secret'] !== FLOW_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const { variantId, profileId } = req.body || {};
  if (!variantId || !profileId) {
    return res.status(400).json({ error: 'Missing variantId or profileId' });
  }

  try {
    // 1) Obtener handle del producto de la variante
    const qHandle = `
      query VariantHandle($id: ID!) {
        productVariant(id: $id) {
          id
          product { id handle title }
        }
      }
    `;
    const handleData = await adminGraphQL(qHandle, { id: variantId });

    const handle = handleData?.data?.productVariant?.product?.handle || '';
    if (!handle) {
      return res.status(400).json({ error: 'Could not resolve product handle for variant', details: handleData?.errors });
    }

    // 2) Excluir si el handle contiene "second-life" (case-insensitive)
    if (handle.toLowerCase().includes('second-life')) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'excluded_by_handle',
        handle
      });
    }

    // 3) Asignar al perfil si no está excluido
    const mutation = `
      mutation AssignToProfile($profileId: ID!, $variantIds: [ID!]!) {
        deliveryProfileAssignProducts(profileId: $profileId, productVariantIds: $variantIds) {
          userErrors { field message }
        }
      }
    `;

    const assignData = await adminGraphQL(mutation, { profileId, variantIds: [variantId] });

    if (assignData.errors) {
      return res.status(500).json({ error: 'GraphQL errors', details: assignData.errors });
    }

    const userErrors = assignData.data?.deliveryProfileAssignProducts?.userErrors || [];
    if (userErrors.length) {
      return res.status(400).json({ error: 'UserErrors', details: userErrors });
    }

    return res.status(200).json({ ok: true, handle });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

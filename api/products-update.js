// api/products-update.js
import crypto from 'crypto';
import fetch from 'node-fetch';

// --- ENV / Constantes ---
const SHOP_DOMAIN   = process.env.SHIP_SHOP_DOMAIN  || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN   = process.env.SHIP_ADMIN_TOKEN  || process.env.SHOPIFY_API_TOKEN || process.env.ADMIN_TOKEN;
const API_VERSION   = process.env.SHIP_API_VERSION  || process.env.API_VERSION || '2025-01';

const PROFILE_REBAJAS_ID = process.env.SHIP_PROFILE_REBAJAS_ID || process.env.REBAJAS_PROFILE_ID;
const PROFILE_GENERAL_ID = process.env.SHIP_PROFILE_GENERAL_ID || process.env.GENERAL_PROFILE_ID;

const EXCLUDE_HANDLE = (process.env.EXCLUDE_HANDLE_SUBSTRING || 'second-life').toLowerCase();
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET; // opcional

// --- Helpers comunes ---
async function adminGraphQL(query, variables = {}) {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    const msg = JSON.stringify(data.errors || data, null, 2);
    throw new Error(`GraphQL error: ${msg}`);
  }
  return data.data;
}

// Asignar (o re-asignar) variantes a un perfil usando deliveryProfileUpdate
async function assignToProfile(profileId, variantIds) {
  if (!profileId || !variantIds || !variantIds.length) return;

  const mutation = `
    mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        userErrors { field message }
      }
    }
  `;

  // troceamos para no mandar listas enormes
  const chunk = (arr, size) =>
    arr.reduce((acc, _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);

  for (const batch of chunk(variantIds, 200)) {
    const variables = {
      id: profileId,
      profile: {
        profileItemsToCreate: [
          {
            appliesTo: {
              productVariantsToAssociate: batch,
            },
          },
        ],
      },
    };

    const data = await adminGraphQL(mutation, variables);
    const errs = data?.deliveryProfileUpdate?.userErrors || [];
    if (errs.length) {
      // si ya estaban asociados, lo consideramos OK
      const onlyAlready = errs.every(e =>
        String(e.message).toLowerCase().includes('already') ||
        String(e.message).toLowerCase().includes('associated')
      );
      if (!onlyAlready) {
        throw new Error(`Assign userErrors: ${JSON.stringify(errs)}`);
      }
    }
  }
}

function gidFromVariant(variant) {
  if (variant?.admin_graphql_api_id) return variant.admin_graphql_api_id;
  const id = String(variant?.id || '').replace(/\D/g, '');
  return id ? `gid://shopify/ProductVariant/${id}` : null;
}

function isDiscounted(variant) {
  const p  = parseFloat(variant?.price ?? '0');
  const cp = parseFloat(variant?.compare_at_price ?? '0');
  return Number.isFinite(p) && Number.isFinite(cp) && cp > p;
}

// Verificación HMAC (best-effort). Si no tienes secreto, devuelve true.
function verifyHmac(req) {
  if (!WEBHOOK_SECRET) return true;
  try {
    // Con express.json no tenemos raw body; reconstruimos JSON.
    const raw = Buffer.from(JSON.stringify(req.body));
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('base64');
    const hmac = req.get('X-Shopify-Hmac-Sha256') || '';
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// --- NUEVO: Recuperar producto por REST si el webhook no trae variants ---
async function fetchProductWithVariantsREST(productIdNum) {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productIdNum}.json?fields=handle,variants`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
  });
  if (!res.ok) throw new Error(`REST product fetch failed: ${res.status}`);
  const { product } = await res.json();
  return product || {};
}

// --- Handler principal ---
export default async function productsUpdate(req, res) {
  try {
    if (!verifyHmac(req)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // Si quieres bloquear, devuelve 401.
      // return res.status(401).json({ ok: false, error: 'invalid_hmac' });
    }

    const payload = req.body || {};

    // 1) usar lo que venga en el webhook
    let handle = String(payload.handle || '').toLowerCase();
    let variants = Array.isArray(payload.variants) ? payload.variants : [];

    // 2) si no hay variants, traemos por REST
    if (!variants.length) {
      const productIdNum = String(payload.id || '').replace(/\D/g, '');
      if (productIdNum) {
        const p = await fetchProductWithVariantsREST(productIdNum);
        if (!handle && p.handle) handle = String(p.handle).toLowerCase();
        variants = Array.isArray(p.variants) ? p.variants : [];
        console.log(`🔁 products/update: webhook sin variants; recuperados via REST: ${variants.length}`);
      }
    }

    // 3) si seguimos sin variants, terminamos limpio
    if (!variants.length) {
      console.log('ℹ️  products/update sin variants tras fetch. OK');
      return res.status(200).json({ ok: true, noVariantsAfterFetch: true });
    }

    // 4) exclusión por handle
    if (handle.includes(EXCLUDE_HANDLE)) {
      console.log(`🟡 Producto excluido por handle: ${handle}`);
      return res.status(200).json({ ok: true, excluded: true });
    }

    // 5) separar por rebaja / normal
    const toRebajas = [];
    const toGeneral = [];

    for (const v of variants) {
      const gid = gidFromVariant(v);
      if (!gid) continue;
      if (isDiscounted(v)) toRebajas.push(gid);
      else toGeneral.push(gid);
    }

    // 6) asignar por lotes
    const ops = [];
    if (PROFILE_REBAJAS_ID && toRebajas.length) {
      ops.push(assignToProfile(PROFILE_REBAJAS_ID, toRebajas));
    }
    if (PROFILE_GENERAL_ID && toGeneral.length) {
      ops.push(assignToProfile(PROFILE_GENERAL_ID, toGeneral));
    }

    await Promise.all(ops);

    console.log('✅ products/update asignado:', {
      handle,
      rebajas: toRebajas.length,
      general: toGeneral.length,
    });

    return res.status(200).json({
      ok: true,
      handle,
      rebajasCount: toRebajas.length,
      generalCount: toGeneral.length,
    });
  } catch (err) {
    console.error('❌ products-update error:', err.message);
    // 200 para que Shopify no haga reintentos masivos
    return res.status(200).json({ ok: false, error: err.message });
  }
}

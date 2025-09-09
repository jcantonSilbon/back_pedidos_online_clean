// api/products-update.js
import crypto from 'crypto';
import fetch from 'node-fetch';

const SHOP_DOMAIN  = process.env.SHIP_SHOP_DOMAIN  || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN  = process.env.SHIP_ADMIN_TOKEN  || process.env.SHOPIFY_API_TOKEN || process.env.ADMIN_TOKEN;
const API_VERSION  = process.env.SHIP_API_VERSION  || process.env.API_VERSION || '2025-01';

const PROFILE_REBAJAS_ID = process.env.SHIP_PROFILE_REBAJAS_ID || process.env.REBAJAS_PROFILE_ID;
const PROFILE_GENERAL_ID = process.env.SHIP_PROFILE_GENERAL_ID || process.env.GENERAL_PROFILE_ID;

const EXCLUDE_HANDLE = (process.env.EXCLUDE_HANDLE_SUBSTRING || 'second-life').toLowerCase();
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// ---------- helpers ----------
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

async function assignToProfile(profileId, variantIds) {
  if (!profileId || !variantIds || !variantIds.length) return;

  const mutation = `
    mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        userErrors { field message }
      }
    }
  `;

  // troceo en lotes por seguridad
  const chunk = (arr, size) => arr.reduce((acc, _, i) =>
    (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);
  const batches = chunk(variantIds, 200);

  for (const batch of batches) {
    const variables = {
      id: profileId,
      profile: {
        profileItemsToCreate: [
          { appliesTo: { productVariantsToAssociate: batch } }
        ]
      }
    };

    const data = await adminGraphQL(mutation, variables);
    const errs = data?.deliveryProfileUpdate?.userErrors || [];
    if (errs.length) {
      const onlyAlreadyLinked = errs.every(e =>
        String(e.message).toLowerCase().includes('already') ||
        String(e.message).toLowerCase().includes('associate')
      );
      if (!onlyAlreadyLinked) {
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

function isDiscounted(v) {
  const p  = parseFloat(v?.price ?? '0');
  // admite REST (compare_at_price) y GraphQL (compareAtPrice)
  const cp = parseFloat((v?.compare_at_price ?? v?.compareAtPrice ?? '0'));
  return Number.isFinite(p) && Number.isFinite(cp) && cp > p;
}

function verifyHmac(req) {
  if (!WEBHOOK_SECRET) return true;
  try {
    const raw = Buffer.from(JSON.stringify(req.body));
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('base64');
    const hmac = req.get('X-Shopify-Hmac-Sha256') || '';
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// --- REST sin fields (para asegurar variants completos)
async function fetchProductREST(productIdNum) {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productIdNum}.json`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': ADMIN_TOKEN }
  });
  if (!res.ok) throw new Error(`REST product fetch failed: ${res.status}`);
  const json = await res.json();
  return json?.product || {};
}

// --- GraphQL fallback
async function fetchProductGQL(productIdNum) {
  const gid = `gid://shopify/Product/${productIdNum}`;
  const q = `
    query($id: ID!){
      product(id:$id){
        handle
        variants(first:250){
          nodes { id price compareAtPrice }
        }
      }
    }
  `;
  const d = await adminGraphQL(q, { id: gid });
  const nodes = d?.product?.variants?.nodes || [];
  // normalizo claves a las del REST para reutilizar lógica
  const variants = nodes.map(n => ({
    admin_graphql_api_id: n.id,
    price: n.price,
    compare_at_price: n.compareAtPrice
  }));
  return { handle: d?.product?.handle || '', variants };
}

// ---------- main ----------
export default async function productsUpdate(req, res) {
  try {
    if (!verifyHmac(req)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // return res.status(401).json({ ok:false, error:'invalid_hmac' });
    }

    const payload = req.body || {};
    let handle = String(payload.handle || '').toLowerCase();
    let variants = Array.isArray(payload.variants) ? payload.variants : [];

    // si no hay variantes en el webhook, intento REST
    if (!variants.length) {
      const productIdNum = String(payload.id || '').replace(/\D/g, '');
      if (productIdNum) {
        const p = await fetchProductREST(productIdNum);
        if (!handle && p.handle) handle = String(p.handle).toLowerCase();
        variants = Array.isArray(p.variants) ? p.variants : [];
        console.log(`🔁 REST fallback: variantes recuperadas = ${variants.length}`);
      }
    }

    // si sigue sin variantes, intento GraphQL
    if (!variants.length) {
      const productIdNum = String(payload.id || '').replace(/\D/g, '');
      if (productIdNum) {
        const p = await fetchProductGQL(productIdNum);
        if (!handle && p.handle) handle = String(p.handle).toLowerCase();
        variants = Array.isArray(p.variants) ? p.variants : [];
        console.log(`🧪 GraphQL fallback: variantes recuperadas = ${variants.length}`);
      }
    }

    if (!variants.length) {
      console.log('ℹ️  products/update sin variants tras fetch. OK');
      return res.status(200).json({ ok: true, noVariantsAfterFetch: true });
    }

    // exclusión por handle
    if (handle.includes(EXCLUDE_HANDLE)) {
      console.log(`🟡 Producto excluido por handle: ${handle}`);
      return res.status(200).json({ ok: true, excluded: true, handle });
    }

    // separar listas
    const toRebajas = [];
    const toGeneral = [];
    for (const v of variants) {
      const gid = gidFromVariant(v);
      if (!gid) continue;
      if (isDiscounted(v)) toRebajas.push(gid);
      else toGeneral.push(gid);
    }

    const ops = [];
    if (PROFILE_REBAJAS_ID && toRebajas.length) ops.push(assignToProfile(PROFILE_REBAJAS_ID, toRebajas));
    if (PROFILE_GENERAL_ID && toGeneral.length) ops.push(assignToProfile(PROFILE_GENERAL_ID, toGeneral));
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
    return res.status(200).json({ ok: false, error: err.message });
  }
}

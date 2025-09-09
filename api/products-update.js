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

/* ============== helpers ============== */
async function adminGraphQL(query, variables = {}) {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    const msg = JSON.stringify(data.errors || data, null, 2);
    throw new Error(`GraphQL error: ${msg}`);
  }
  return data.data;
}

// 👉 única función de asignación (moderna) con fallback a AssignProducts
async function assignToProfile(profileId, variantIds) {
  if (!profileId || !variantIds?.length) return;

  // lotes razonables
  const chunk = (arr, size) => arr.reduce((acc, _, i) =>
    (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);
  const batches = chunk(variantIds, 200);

  for (const batch of batches) {
    // 1) deliveryProfileUpdate con variantsToAssociate
    try {
      const m1 = `
        mutation AssignVariants($id: ID!, $assoc: [ID!], $dissoc: [ID!]) {
          deliveryProfileUpdate(
            id: $id,
            profile: { variantsToAssociate: $assoc, variantsToDissociate: $dissoc }
          ) {
            userErrors { field message }
          }
        }
      `;
      const d1 = await adminGraphQL(m1, { id: profileId, assoc: batch, dissoc: [] });
      const errs1 = d1?.deliveryProfileUpdate?.userErrors || [];
      const benign1 = errs1.every(e => /already|associated/i.test(String(e?.message || '')));
      if (errs1.length && !benign1) {
        throw new Error(`userErrors: ${JSON.stringify(errs1)}`);
      }
      continue; // OK o solo "ya asociado"
    } catch (e1) {
      // 2) fallback: deliveryProfileAssignProducts (según tienda/API)
      try {
        const m2 = `
          mutation AssignProducts($id: ID!, $assoc: [ID!], $dissoc: [ID!]) {
            deliveryProfileAssignProducts(
              profileId: $id,
              productVariantIdsToAssociate: $assoc,
              productVariantIdsToDissociate: $dissoc
            ) {
              userErrors { field message }
            }
          }
        `;
        const d2 = await adminGraphQL(m2, { id: profileId, assoc: batch, dissoc: [] });
        const errs2 = d2?.deliveryProfileAssignProducts?.userErrors || [];
        const benign2 = errs2.every(e => /already|associated/i.test(String(e?.message || '')));
        if (errs2.length && !benign2) {
          throw new Error(`fallback userErrors: ${JSON.stringify(errs2)}`);
        }
      } catch (e2) {
        // Si también falla, lo propagamos (no intentamos legacy para evitar tu error)
        throw e2;
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
  const cp = parseFloat((v?.compare_at_price ?? v?.compareAtPrice ?? '0'));
  return Number.isFinite(p) && Number.isFinite(cp) && cp > p;
}

function verifyHmac(req, rawBody) {
  if (!WEBHOOK_SECRET) return true;
  try {
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256') || '';
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

async function fetchProductREST(productIdNum) {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productIdNum}.json`;
  const res = await fetch(url, { method: 'GET', headers: { 'X-Shopify-Access-Token': ADMIN_TOKEN } });
  if (!res.ok) throw new Error(`REST product fetch failed: ${res.status}`);
  const json = await res.json();
  return json?.product || {};
}

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
  const variants = nodes.map(n => ({
    admin_graphql_api_id: n.id,
    price: n.price,
    compare_at_price: n.compareAtPrice
  }));
  return { handle: d?.product?.handle || '', variants };
}

/* ============== main handler ============== */
export default async function productsUpdate(req, res) {
  try {
    // HMAC con raw body
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyHmac(req, rawBody)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // return res.status(401).json({ ok:false, error:'invalid_hmac' });
    }

    // Parse seguro (puede venir buffer)
    let payload;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (req.body || {});
    } catch { payload = {}; }

    let handle = String(payload.handle || '').toLowerCase();
    let variants = Array.isArray(payload.variants) ? payload.variants : [];

    const productIdNum =
      String(payload.id || '').replace(/\D/g, '') ||
      String(payload.admin_graphql_api_id || '').replace(/\D/g, '');

    // Fallback REST si no llegan variants en el webhook
    if (!variants.length && productIdNum) {
      const p = await fetchProductREST(productIdNum);
      if (!handle && p.handle) handle = String(p.handle).toLowerCase();
      variants = Array.isArray(p.variants) ? p.variants : [];
      console.log(`🔁 REST fallback: variantes recuperadas = ${variants.length} (productId=${productIdNum})`);
    }

    // Fallback GraphQL si aún no hay
    if (!variants.length && productIdNum) {
      const p = await fetchProductGQL(productIdNum);
      if (!handle && p.handle) handle = String(p.handle).toLowerCase();
      variants = Array.isArray(p.variants) ? p.variants : [];
      console.log(`🧪 GraphQL fallback: variantes recuperadas = ${variants.length} (productId=${productIdNum})`);
    }

    if (!variants.length) {
      console.log('ℹ️  products/update sin variants tras fetch. OK');
      return res.status(200).json({ ok: true, noVariantsAfterFetch: true });
    }

    // Exclusión por handle
    if (handle.includes(EXCLUDE_HANDLE)) {
      console.log(`🟡 Producto excluido por handle: ${handle}`);
      return res.status(200).json({ ok: true, excluded: true, handle });
    }

    // Clasificar variantes
    const toRebajas = [];
    const toGeneral = [];
    for (const v of variants) {
      const gid = gidFromVariant(v);
      if (!gid) continue;
      if (isDiscounted(v)) toRebajas.push(gid);
      else toGeneral.push(gid);
    }

    // Asignar
    const ops = [];
    if (PROFILE_REBAJAS_ID && toRebajas.length) ops.push(assignToProfile(PROFILE_REBAJAS_ID, toRebajas));
    if (PROFILE_GENERAL_ID && toGeneral.length) ops.push(assignToProfile(PROFILE_GENERAL_ID, toGeneral));
    await Promise.all(ops);

    console.log('✅ products/update asignado:', { handle, rebajas: toRebajas.length, general: toGeneral.length });

    return res.status(200).json({
      ok: true,
      handle,
      rebajasCount: toRebajas.length,
      generalCount: toGeneral.length,
    });
  } catch (err) {
    console.error('❌ products-update error:', err.message);
    // 200 para evitar reintentos masivos
    return res.status(200).json({ ok: false, error: err.message });
  }
}

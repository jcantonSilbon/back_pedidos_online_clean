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

// Intento robusto: prueba 3 mutaciones distintas según versión de API
async function assignToProfile(profileId, variantIds) {
  if (!profileId || !variantIds || !variantIds.length) return;

  const chunk = (arr, size) => arr.reduce(
    (acc, _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), []
  );

  for (const batch of chunk(variantIds, 200)) {
    // 1) deliveryProfileUpdate (variantsToAssociate / variantsToDissociate)
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
      if (errs1.length) {
        const onlyAlready = errs1.every(e => /already|associated/i.test(e.message || ''));
        if (!onlyAlready) throw new Error(`schema1: ${JSON.stringify(errs1)}`);
      }
      continue; // ok o sólo "ya asociado"
    } catch (e1) {
      // 2) deliveryProfileAssignProducts (productVariantIdsToAssociate / ToDissociate)
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
        if (errs2.length) {
          const onlyAlready = errs2.every(e => /already|associated/i.test(e.message || ''));
          if (!onlyAlready) throw new Error(`schema2: ${JSON.stringify(errs2)}`);
        }
        continue; // ok
      } catch (e2) {
        // 3) legacy: deliveryProfileUpdate con profileItemsToCreate
        const m3 = `
          mutation AssignLegacy($id: ID!, $variants: [ID!]) {
            deliveryProfileUpdate(
              id: $id,
              profile: {
                profileItemsToCreate: [
                  { appliesTo: { productVariantsToAssociate: $variants } }
                ]
              }
            ) {
              userErrors { field message }
            }
          }
        `;
        const d3 = await adminGraphQL(m3, { id: profileId, variants: batch });
        const errs3 = d3?.deliveryProfileUpdate?.userErrors || [];
        if (errs3.length) {
          const onlyAlready = errs3.every(e => /already|associate/i.test(e.message || ''));
          if (!onlyAlready) {
            throw new Error(`Assign failed: ${JSON.stringify(errs3)}`);
          }
        }
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
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': ADMIN_TOKEN }
  });
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
    // Asegurar rawBody y validar HMAC
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyHmac(req, rawBody)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // Si quieres cortar duro, descomenta:
      // return res.status(401).json({ ok:false, error:'invalid_hmac' });
    }

    // Parse payload (puede venir en Buffer)
    let payload;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (req.body || {});
    } catch {
      payload = {};
    }

    let handle = String(payload.handle || '').toLowerCase();
    let variants = Array.isArray(payload.variants) ? payload.variants : [];

    const productIdNum =
      String(payload.id || '').replace(/\D/g, '') ||
      String(payload.admin_graphql_api_id || '').replace(/\D/g, '');

    // Fallback REST si no llegan variantes
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
    // 200 para no forzar reintentos masivos de Shopify; el error queda logueado
    return res.status(200).json({ ok: false, error: err.message });
  }
}

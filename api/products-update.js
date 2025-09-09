// api/products-update.js
import crypto from 'crypto';
import fetch from 'node-fetch';

const SHOP_DOMAIN  = process.env.SHIP_SHOP_DOMAIN  || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN  = process.env.SHIP_ADMIN_TOKEN  || process.env.SHOPIFY_API_TOKEN || process.env.ADMIN_TOKEN;
const API_VERSION  = process.env.SHIP_API_VERSION  || process.env.API_VERSION || '2025-01';

const PROFILE_REBAJAS_ID = process.env.SHIP_PROFILE_REBAJAS_ID || process.env.REBAJAS_PROFILE_ID;
const PROFILE_GENERAL_ID = process.env.SHIP_PROFILE_GENERAL_ID || process.env.GENERAL_PROFILE_ID; // puede ser default

const EXCLUDE_HANDLE = (process.env.EXCLUDE_HANDLE_SUBSTRING || 'second-life').toLowerCase();
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

/* ---------------- helpers comunes ---------------- */
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

const chunk = (arr, size) =>
  (arr || []).reduce((acc, _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);

/**
 * Única mutación soportada hoy:
 * deliveryProfileUpdate(profile: { variantsToAssociate, variantsToDissociate })
 * Lotes de 200.
 *
 * Nota: tratamos como “benignos”:
 *  - “already/associated/exists”
 *  - “Default Profile product variant cannot be dissociated.”
 */
async function updateProfile(profileId, toAssociate = [], toDissociate = []) {
  if (!profileId) return;
  if ((!toAssociate || !toAssociate.length) && (!toDissociate || !toDissociate.length)) return;

  const MUTATION = `
    mutation AssignVariants($id: ID!, $assoc: [ID!], $dissoc: [ID!]) {
      deliveryProfileUpdate(
        id: $id,
        profile: {
          variantsToAssociate: $assoc
          variantsToDissociate: $dissoc
        }
      ) {
        userErrors { field message }
      }
    }
  `;

  const assocBatches = chunk(toAssociate, 200);
  const dissocBatches = chunk(toDissociate, 200);
  const rounds = Math.max(assocBatches.length, dissocBatches.length) || 1;

  for (let i = 0; i < rounds; i++) {
    const assoc = assocBatches[i] || [];
    const dissoc = dissocBatches[i] || [];
    const data = await adminGraphQL(MUTATION, { id: profileId, assoc, dissoc });

    const errs = data?.deliveryProfileUpdate?.userErrors || [];
    if (errs.length) {
      const benign = errs.every(e => {
        const msg = String(e?.message || '').toLowerCase();
        return (
          msg.includes('already') ||
          msg.includes('associated') ||
          msg.includes('exists') ||
          msg.includes('default profile product variant cannot be dissociated')
        );
      });
      if (!benign) throw new Error(`Assign variants errors: ${JSON.stringify(errs)}`);
      // si eran benignos, los ignoramos
    }
  }
}

function gidFromVariant(v) {
  if (v?.admin_graphql_api_id) return v.admin_graphql_api_id;
  const id = String(v?.id || '').replace(/\D/g, '');
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
    const h = req.get('X-Shopify-Hmac-Sha256') || '';
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(h));
  } catch { return false; }
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

/* ---------------- handler webhook ---------------- */
export default async function productsUpdate(req, res) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyHmac(req, rawBody)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // return res.status(401).json({ ok:false, error:'invalid_hmac' });
    }

    // Parseo seguro (puede venir en Buffer)
    let payload;
    try { payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (req.body || {}); }
    catch { payload = {}; }

    let handle = String(payload.handle || '').toLowerCase();
    let variants = Array.isArray(payload.variants) ? payload.variants : [];

    const productIdNum =
      String(payload.id || '').replace(/\D/g, '') ||
      String(payload.admin_graphql_api_id || '').replace(/\D/g, '');

    // Fallbacks para traer variantes si el webhook viene pelado
    if (!variants.length && productIdNum) {
      const p = await fetchProductREST(productIdNum);
      if (!handle && p.handle) handle = String(p.handle).toLowerCase();
      variants = Array.isArray(p.variants) ? p.variants : [];
      console.log(`🔁 REST fallback: variantes recuperadas = ${variants.length} (productId=${productIdNum})`);
    }
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

    if (handle.includes(EXCLUDE_HANDLE)) {
      console.log(`🟡 Producto excluido por handle: ${handle}`);
      return res.status(200).json({ ok: true, excluded: true, handle });
    }

    // Clasificar
    const toRebajas = [];
    const toGeneral = [];
    for (const v of variants) {
      const gid = gidFromVariant(v);
      if (!gid) continue;
      if (isDiscounted(v)) toRebajas.push(gid);
      else toGeneral.push(gid);
    }

    // Operaciones:
    //  - CON DESCUENTO: asociar a REBAJAS; (opcional) quitar de GENERAL (si GENERAL no es Default; si lo es, error benigno)
    //  - SIN DESCUENTO: quitar de REBAJAS para que caiga al Default automáticamente
    const ops = [];

    if (PROFILE_REBAJAS_ID) {
      if (toRebajas.length) ops.push(updateProfile(PROFILE_REBAJAS_ID, toRebajas, []));   // mover a Rebajas
      if (toGeneral.length) ops.push(updateProfile(PROFILE_REBAJAS_ID, [], toGeneral));   // salir de Rebajas cuando ya no hay descuento
    }

    if (PROFILE_GENERAL_ID) {
      // Cuando pasan a Rebajas intentamos quitarlos de "General" por si "General" fuese un perfil custom.
      // Si es el Default, Shopify devolverá "Default Profile product variant cannot be dissociated." y lo ignoramos.
      if (toRebajas.length) ops.push(updateProfile(PROFILE_GENERAL_ID, [], toRebajas));
      // OJO: no asociamos explícitamente a GENERAL. Para volver al Default basta con desasociar de los custom.
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
    return res.status(200).json({ ok: false, error: err.message });
  }
}

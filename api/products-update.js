// api/products-update.js
import crypto from 'crypto';
import fetch from 'node-fetch';

// Prioriza variables SHIP_* y cae a genéricas si no existen
const SHOP_DOMAIN  = process.env.SHIP_SHOP_DOMAIN  || process.env.SHOP_DOMAIN;
const ADMIN_TOKEN  = process.env.SHIP_ADMIN_TOKEN  || process.env.SHOPIFY_API_TOKEN || process.env.ADMIN_TOKEN;
const API_VERSION  = process.env.SHIP_API_VERSION  || process.env.API_VERSION || '2025-01';

// IDs de perfiles (GIDs). Ponlos en .env
// Ej.: REBAJAS: gid://shopify/DeliveryProfile/128100729209
const PROFILE_REBAJAS_ID = process.env.SHIP_PROFILE_REBAJAS_ID || process.env.REBAJAS_PROFILE_ID;
const PROFILE_GENERAL_ID = process.env.SHIP_PROFILE_GENERAL_ID || process.env.GENERAL_PROFILE_ID;

// Subcadena para excluir por handle (case-insensitive)
const EXCLUDE_HANDLE = (process.env.EXCLUDE_HANDLE_SUBSTRING || 'second-life').toLowerCase();

// Opcional: secreto del webhook para validar HMAC (si lo tienes)
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// --- helpers ---
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

  // trocear en lotes razonables (p.e. 200)
  const chunk = (arr, size) => arr.reduce((acc, _, i) =>
    (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);

  const batches = chunk(variantIds, 200);

  for (const batch of batches) {
    const variables = {
      id: profileId,
      profile: {
        // creamos un único profileItem que asocia todas las variantes del lote
        profileItemsToCreate: [
          {
            appliesTo: {
              productVariantsToAssociate: batch
            }
          }
        ]
      }
    };

    const data = await adminGraphQL(mutation, variables);

    const errs = data?.deliveryProfileUpdate?.userErrors || [];
    if (errs.length) {
      // si alguna ya está asociada, lo consideramos OK y seguimos
      const onlyAlreadyLinked = errs.every(e =>
        String(e.message).toLowerCase().includes('already') ||
        String(e.message).toLowerCase().includes('associated')
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

function isDiscounted(variant) {
  const p  = parseFloat(variant?.price ?? '0');
  const cp = parseFloat(variant?.compare_at_price ?? '0');
  return Number.isFinite(p) && Number.isFinite(cp) && cp > p;
}

// (opcional) verificación HMAC; si no tienes el secreto configurado, se ignora.
function verifyHmac(req) {
  if (!WEBHOOK_SECRET) return true;
  try {
    // WARNING: al tener app.use(express.json()) puede que no tengamos el raw body exacto.
    // Recompongo el raw como JSON string. Si quisieras verificación estricta, monta un raw parser por ruta.
    const raw = Buffer.from(JSON.stringify(req.body));
    const digest = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(raw)
      .digest('base64');
    const hmac = req.get('X-Shopify-Hmac-Sha256') || '';
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

export default async function productsUpdate(req, res) {
  try {
    // 1) seguridad (mejor best-effort; si falla y quieres estricta, ver nota del raw body arriba)
    if (!verifyHmac(req)) {
      console.warn('⚠️  HMAC inválido en products/update');
      // no corto la ejecución para no romper tu flujo, pero si quieres, descomenta:
      // return res.status(401).json({ ok: false, error: 'invalid_hmac' });
    }

    const payload = req.body || {};
    const handle = String(payload.handle || '').toLowerCase();

    // 2) excluir por handle
    if (handle.includes(EXCLUDE_HANDLE)) {
      console.log(`🟡 Producto excluido por handle: ${handle}`);
      return res.status(200).json({ ok: true, excluded: true });
    }

    const variants = Array.isArray(payload.variants) ? payload.variants : [];
    if (variants.length === 0) {
      console.log('ℹ️  products/update sin variants. OK');
      return res.status(200).json({ ok: true, noVariants: true });
    }

    // 3) separamos por rebaja / normal
    const toRebajas = [];
    const toGeneral = [];

    for (const v of variants) {
      const gid = gidFromVariant(v);
      if (!gid) continue;
      if (isDiscounted(v)) toRebajas.push(gid);
      else toGeneral.push(gid);
    }

    // 4) asignaciones por lotes (solo si hay perfiles definidos)
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
    // responde 200 para evitar reintentos masivos de Shopify, pero registra el error
    return res.status(200).json({ ok: false, error: err.message });
  }
}

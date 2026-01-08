import crypto from "crypto";

function hmacSha256Hex(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

function safeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(String(a), "hex");
    const bufB = Buffer.from(String(b), "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function wappingWebhookHandler(req, res) {
  const alwaysOk = () => res.status(200).json({ ok: true });

  const secret = process.env.WAPPING_WEBHOOK_SECRET;
  const maxSkew = Number(process.env.WAPPING_MAX_SKEW_SECONDS || "300");

  if (!secret) return alwaysOk();

  const signature = req.header("Wapping-Signature");
  const timestampHeader = req.header("Wapping-Timestamp");

  if (!signature || !timestampHeader) return alwaysOk();

  const ts = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);

  if (!Number.isFinite(ts) || skew > maxSkew) return alwaysOk();

  const rawBody = req.body?.toString("utf8") || "";
  const signedPayload = `${ts}.${rawBody}`;
  const expectedSig = hmacSha256Hex(secret, signedPayload);

  if (!safeEqualHex(expectedSig, signature)) return alwaysOk();

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return alwaysOk();
  }

  const { entityCode, eventCode, entity } = payload || {};

  if (entityCode !== "Customer") return alwaysOk();

  console.log("[WAPPING]", eventCode, entity);

  // 👉 AQUÍ luego:
  // - marcar People
  // - baja
  // - sync Shopify / Salesmanago / lo que sea

  return alwaysOk();
}

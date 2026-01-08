import crypto from "crypto";
import { addCustomerTag } from "../src/services/shopify.js";


function hmacSha256Hex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
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

function maskEmail(email) {
  if (!email || typeof email !== "string") return email;
  const [u, d] = email.split("@");
  if (!d) return "***";
  return `${u?.slice(0, 2) || ""}***@${d}`;
}
function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return phone;
  const last = phone.slice(-3);
  return `***${last}`;
}

export async function wappingWebhookHandler(req, res) {
  const alwaysOk = (reason) => {
    console.log("[WAPPING] -> 200 ignored:", reason);
    return res.status(200).json({ ok: true });
  };

  // 1) Log de entrada (para saber que pega)
  console.log("[WAPPING] HIT", new Date().toISOString());

  const secret = process.env.WAPPING_WEBHOOK_SECRET;
  const maxSkew = Number(process.env.WAPPING_MAX_SKEW_SECONDS || "300");

  const signature = req.header("Wapping-Signature");
  const timestampHeader = req.header("Wapping-Timestamp");
  const contentType = req.header("content-type");

  console.log("[WAPPING] headers:", {
    hasSecret: !!secret,
    contentType,
    hasSignature: !!signature,
    hasTimestamp: !!timestampHeader,
  });

  if (!secret) return alwaysOk("missing_secret");
  if (!signature || !timestampHeader) return alwaysOk("missing_headers");

  const ts = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);

  console.log("[WAPPING] time:", { ts, now, skew, maxSkew });

  if (!Number.isFinite(ts) || skew > maxSkew) return alwaysOk("timestamp_out_of_window");

  const rawBody = req.body?.toString("utf8") || "";
  console.log("[WAPPING] raw length:", rawBody.length);

  const signedPayload = `${ts}.${rawBody}`;
  const expectedSig = hmacSha256Hex(secret, signedPayload);

  const sigOk = safeEqualHex(expectedSig, signature);
  console.log("[WAPPING] signature ok?:", sigOk);

  if (!sigOk) {
    // No mostramos firmas completas (por seguridad), solo un trocito
    console.log("[WAPPING] signature mismatch:", {
      got: String(signature).slice(0, 10) + "...",
      expected: String(expectedSig).slice(0, 10) + "...",
    });
    return alwaysOk("bad_signature");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return alwaysOk("invalid_json");
  }

  const { entityCode, eventCode, entity } = payload || {};

  // Log “limpio” del evento
  console.log("[WAPPING] event:", { entityCode, eventCode });

  // Log “sanitizado” de entity
  const safeEntity = entity
    ? {
        ...entity,
        email: maskEmail(entity.email),
        phone: maskPhone(entity.phone),
        mobile: maskPhone(entity.mobile),
      }
    : null;

  console.log("[WAPPING] entity (safe):", safeEntity);

    const eCode = String(entityCode || "").toUpperCase();
  const evCode = String(eventCode || "").toUpperCase();

  if (eCode === "CUSTOMER" && (evCode === "CREATE" || evCode === "UPDATE")) {
    const thirdPartyId = entity?.thirdPartyIdentifiers?.find(
      (x) =>
        typeof x?.thirdPartyId === "string" &&
        x.thirdPartyId.startsWith("gid://shopify/Customer/")
    )?.thirdPartyId;

    if (thirdPartyId) {
      try {
        await addCustomerTag({ customerGid: thirdPartyId, tag: "SilbonPeople" });
        console.log("[WAPPING] Shopify tag added:", thirdPartyId);
      } catch (err) {
        console.log("[WAPPING] Shopify tag add failed:", err.message);
      }
    } else {
      console.log("[WAPPING] No Shopify Customer GID found in thirdPartyIdentifiers");
    }
  }


  return res.status(200).json({ ok: true });
}

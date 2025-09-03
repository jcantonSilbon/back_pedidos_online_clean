// backend/src/utils/zendesk.js (arriba del export)
function escapeHTML(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildShopifyContactHTML({ country = "ES", name, email, phone, subject, order, body }) {
  const row = (label, value) => `
    <tr>
      <td style="padding:8px 12px; color:#374151; width:220px; white-space:nowrap;"><strong>${label}</strong></td>
      <td style="padding:8px 12px;">
        <div style="padding:10px 12px; border:1px solid #e5e7eb; border-radius:6px; background:#f9fafb;">
          ${value || "-"}
        </div>
      </td>
    </tr>`;

  return `
  <div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <p style="margin:0 0 12px 0;">Recibiste un nuevo mensaje del formulario de contacto de tu tienda online.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;width:100%;max-width:760px;">
      ${row("Código de país:", escapeHTML(country))}
      ${row("Name:", escapeHTML(name))}
      ${row("Correo electrónico:", escapeHTML(email))}
      ${row("Teléfono:", escapeHTML(phone))}
      ${row("Custom Field 0:", escapeHTML(subject))}
      ${row("Order:", escapeHTML(order))}
      ${row("Cuerpo:", escapeHTML(body))}
    </table>

    <div style="margin-top:16px; color:#6b7280; font-size:13px;">
      Puedes habilitar el filtro de correo no deseado para los formularios de contacto en las preferencias de la tienda online.
    </div>
  </div>`;
}


export async function createZendeskTicket({ name, email, phone, order, subject, body, country }) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const userEmail = process.env.ZENDESK_EMAIL;
  const token     = process.env.ZENDESK_API_TOKEN;

  if (!subdomain || !userEmail || !token) throw new Error("Zendesk env vars missing");

  const auth = Buffer.from(`${userEmail}/token:${token}`).toString("base64");

  const html = buildShopifyContactHTML({ country, name, email, phone, subject, order, body });

  const ticket = {
    ticket: {
      subject: "Recibiste un nuevo mensaje del formulario de contacto de tu tienda online.",
      comment: {
        html_body: html,        // 👈 HTML como el correo antiguo
        public: true
      },
      requester: {
        name: name || "Cliente tienda",
        email: email || "no-reply+contact@silbon.com"
      },
      tags: ["shopify_contact_form"],
      priority: "normal"
    }
  };

  const resp = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(ticket)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zendesk ${resp.status}: ${text}`);
  }
  return resp.json();
}

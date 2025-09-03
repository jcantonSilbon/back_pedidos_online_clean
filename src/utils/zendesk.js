export async function createZendeskTicket({ name, email, phone, order, subject, body }) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;   // ej: "silbon"
  const userEmail = process.env.ZENDESK_EMAIL;       // ej: "javier@silbon.es"
  const token     = process.env.ZENDESK_API_TOKEN;   // token API

  if (!subdomain || !userEmail || !token) throw new Error("Zendesk env vars missing");

  const auth = Buffer.from(`${userEmail}/token:${token}`).toString("base64");

  const ticket = {
    ticket: {
      subject: subject || `Contacto tienda: ${name || "Cliente"}`,
      comment: { body:
`Nombre: ${name || "-"}
Email: ${email || "-"}
Teléfono: ${phone || "-"}
Pedido: ${order || "-"}

Mensaje:
${body || "-"}` },
      requester: { name: name || "Cliente tienda", email: email || "no-reply+contact@silbon.com" },
      tags: ["shopify_contact_form"],
      priority: "normal"
    }
  };

  const resp = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
    method: "POST",
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(ticket)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zendesk ${resp.status}: ${text}`);
  }
  return resp.json(); // { ticket: { id, ... } }
}

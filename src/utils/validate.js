export function sanitize(str = "", { max = 5000 } = {}) {
  return String(str).replace(/\u0000/g, "").replace(/<[^>]*>/g, "").trim().slice(0, max);
}
export function isEmail(s = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}
export function validatePayload(body) {
  const errors = [];
  const payload = {
    name:    sanitize(body?.name,   { max: 150 }),
    email:   sanitize(body?.email,  { max: 200 }),
    phone:   sanitize(body?.phone,  { max: 50 }),
    order:   sanitize(body?.order,  { max: 100 }),
    subject: sanitize(body?.subject,{ max: 200 }),
    body:    sanitize(body?.body,   { max: 5000 }),
  };
  if (!payload.name)  errors.push("nombre vacío");
  if (!payload.email || !isEmail(payload.email)) errors.push("email inválido");
  if (!payload.body)  errors.push("mensaje vacío");
  return { payload, errors };
}

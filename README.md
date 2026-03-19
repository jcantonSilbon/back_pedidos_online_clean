# back_pedidos_online_clean

Backend Node.js que **genera y envía por email los informes de pedidos online** cruzando datos de **Shopify** y **Salesmanago** para analizar los tiempos de entrega y los pedidos recibidos/no recibidos.

---

## 📊 Funcionalidad

1. Consulta pedidos desde **Shopify**.
2. Cruza con **Salesmanago** para obtener la `fecha_encuesta`.
3. Calcula:
   - Días entre `fecha_pedido` y `fecha_encuesta`.
   - Si el pedido fue recibido o no.
   - Promedio de entrega y porcentaje de retrasos.
4. Genera dos archivos:
   - **PDF con gráficos** (donut + barras mensuales).
   - **Excel con el detalle de todos los pedidos**.
5. Envía el informe automáticamente por email a **Cristina López**.

---

## 📅 Automatización

Ejecución programada con **node-cron**:
- **Informe semanal** → cada lunes a las **09:00 (Europe/Madrid)**.  
- **Informe mensual** → primer día de cada mes a las **09:00**.

Correo enviado desde **Resend** a:  REPORT_TO_EMAIL=cristina.lopez@silbon.com


---

## 🔗 Integración Wapping → Shopify (People)

El backend incluye una **integración en tiempo real con Wapping** para sincronizar el estado de clientes **People** con Shopify mediante webhooks.

### 📥 Webhook

Endpoint productivo: POST /webhooks/wapping


- Recibe eventos de la entidad `Customer` desde Wapping.
- Eventos soportados:
  - `Customer / Create`
  - `Customer / Update`
  - `Customer / Delete`
- El body se procesa en **RAW** para poder validar correctamente la firma.

---

### 🔐 Seguridad del webhook

Cada evento recibido se valida mediante:
- Header `Wapping-Timestamp`
- Header `Wapping-Signature`
- Firma calculada con: HMAC-SHA256(secret, "{timestamp}.{rawBody}")

- Control anti-replay mediante ventana temporal configurable.
- El endpoint **siempre responde HTTP 200**, incluso si el evento se ignora (según especificación de Wapping).

---

### 🔁 Sincronización de clientes People

Cuando se recibe un evento `Customer / Create` o `Customer / Update`:

- Se busca un identificador de cliente Shopify en: entity.thirdPartyIdentifiers[].thirdPartyId
- Si existe un identificador con formato: gid://shopify/Customer/XXXX
- Se añade automáticamente en Shopify la tag: SilbonPeople


✔️ Operación idempotente  
✔️ No sobrescribe ni elimina tags existentes  
✔️ Sincronización en tiempo real

---

### 🛒 Shopify

- Integración mediante **Shopify Admin GraphQL API**.
- Mutación utilizada: `tagsAdd`.
- Variables de entorno requeridas:
- `SHIP_SHOP_DOMAIN`
- `SHOPIFY_API_TOKEN`
- `SHIP_API_VERSION`

---

## ✍️ Autor

**Javier García-Rojo Cantón**  
Lead Developer — Silbon








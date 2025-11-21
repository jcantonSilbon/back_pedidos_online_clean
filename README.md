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

Correo enviado desde **Resend** a: REPORT_TO_EMAIL=cristina.lopez@silbon.com











Autor: Javier García-Rojo Cantón — Lead Developer, Silbon

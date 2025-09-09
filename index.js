import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import QuickChart from 'quickchart-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

import { validatePayload } from "./src/utils/validate.js";
import { createZendeskTicket } from "./src/utils/zendesk.js";
import assignProfile from './api/assign-profile.js';
import productsUpdate from './api/products-update.js';

dotenv.config();
const app = express();
app.use(cors());

// 🔐 Webhook de Shopify con RAW body para HMAC real
app.post(
  '/api/products-update',
  express.raw({ type: 'application/json' }),
  productsUpdate
);

// Para el resto de endpoints JSON normales
app.use(express.json());

function generateSha(apiKey, clientId, apiSecret) {
  return crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');
}

// SHOPIFY - Obtener pedido por número
app.get('/api/order/:id', async (req, res) => {
  const orderNumber = req.params.id;
  try {
    const response = await axios.get(
      `${process.env.SHOPIFY_API_URL}.json?name=${orderNumber}`,
      { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' } }
    );
    const order = response.data.orders?.[0];
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ order });
  } catch (error) {
    console.error(`Error al obtener pedido ${orderNumber}:`, error.message);
    res.status(500).json({ error: 'Error al obtener el pedido' });
  }
});

// ---- Salesmanago helpers / endpoints (tu código tal cual) ----
async function upsertOrderToSalesmanago(email, orderNumber, orderDate) {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = process.env.SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();
  const sha = generateSha(apiKey, clientId, apiSecret);

  const payload = {
    clientId, apiKey, sha, requestTime, owner,
    contact: { email },
    properties: { num_pedido: orderNumber, fecha_pedido: orderDate }
  };

  try {
    const response = await axios.post('https://app3.salesmanago.com/api/contact/upsert', payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`✅ Pedido ${orderNumber} subido para ${email}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error al subir pedido de ${email}:`, error.response?.data || error.message);
  }
}

app.post('/api/sm-upsert', async (req, res) => {
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const owner = process.env.SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();

  const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

  const data = {
    clientId, apiKey, sha, requestTime, owner,
    contact: { email: 'prueba@example.com', name: 'Prueba Test', state: 'PROSPECT' }
  };

  try {
    const response = await axios.post(process.env.SMANAGO_API_URL, data, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch (error) {
    console.error('❌ Error conexión:', error.response?.data || error.message);
    res.status(500).json({ error: 'Falló la conexión con Salesmanago' });
  }
});

app.post('/api/sm-export-tag', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com';
  const requestTime = Date.now();
  const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

  const payload = {
    clientId, apiKey, requestTime, sha, owner,
    contacts: [{ addresseeType: 'tag', value: 'LANDINGPAGE_RECEPCION_PEDIDO' }],
    data: [{ dataType: 'CONTACT' }, { dataType: 'PROPERTIES' }]
  };

  try {
    const response = await axios.post('https://app3.salesmanago.pl/api/contact/export/data', payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('📤 Exportación solicitada. Respuesta:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('❌ Error exportando contactos:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error exportando contactos' });
  }
});

app.get('/api/sm-export-status/:requestId', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com';
  const requestTime = Date.now();
  const requestId = req.params.requestId;
  const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

  const payload = { clientId, apiKey, requestTime, sha, owner, requestId };

  try {
    const response = await axios.post('https://app3.salesmanago.pl/api/job/status', payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('📥 Estado de la exportación:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('❌ Error consultando estado:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error consultando estado de la exportación' });
  }
});

app.get('/api/sm-export-download/:requestId', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com';
  const requestTime = Date.now();
  const requestId = req.params.requestId;
  const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

  const payload = { clientId, apiKey, requestTime, sha, owner, requestId };

  try {
    const statusRes = await axios.post('https://app3.salesmanago.pl/api/job/status', payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const fileUrl = statusRes.data?.fileUrl;
    if (!fileUrl) return res.status(404).json({ error: 'Archivo aún no disponible' });
    const fileRes = await axios.get(fileUrl);
    res.json(fileRes.data);
  } catch (error) {
    console.error('❌ Error al descargar:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error descargando archivo de contactos' });
  }
});

app.post('/api/sm-confirmed-received', async (req, res) => {
  const allowedIps = ['89.25.223.94', '89.25.223.95'];
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress?.replace('::ffff:', '');
  const { id, email } = req.body;

  if (!allowedIps.includes(ip)) return res.status(403).json({ error: 'IP no autorizada' });
  if (id !== 'ff9f1f0d-ffb7-4a00-9d84-999d2657f303') return res.status(403).json({ error: 'id inválido' });
  if (!email) return res.status(400).json({ error: 'Email no proporcionado' });

  try {
    const response = await axios.get(`${process.env.SHOPIFY_API_URL}.json?email=${email}`, {
      headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' }
    });

    const order = response.data.orders?.[0];
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const orderNumber = order.name?.replace('#', '') || 'N/A';
    const orderDate = order.created_at?.split('T')[0] || '';

    // Subir a Salesmanago
    const clientId = process.env.SMANAGO_CLIENT_ID;
    const apiKey = process.env.SMANAGO_API_KEY;
    const apiSecret = process.env.SMANAGO_API_SECRET;
    const owner = process.env.SMANAGO_OWNER_EMAIL;
    const requestTime = Date.now();
    const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

    const payload = {
      clientId, apiKey, sha, requestTime, owner,
      contact: { email },
      properties: { num_pedido: orderNumber, fecha_pedido: orderDate }
    };

    await axios.post('https://app3.salesmanago.com/api/contact/upsert', payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`✅ Pedido ${orderNumber} subido para ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`❌ Error procesando ${email}:`, err.response?.data || err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Reportes (tu código tal cual) ----
async function generateAndSendExcelReport() {
  try {
    const exportRes = await axios.post(`${process.env.BASE_URL}/api/sm-export-tag`);
    const requestId = exportRes.data?.requestId;
    if (!requestId) throw new Error('❌ No se recibió requestId');

    const retries = 10;
    const delay = 10000;
    let contacts = [];

    for (let i = 0; i < retries; i++) {
      try {
        const resDownload = await axios.get(`${process.env.BASE_URL}/api/sm-export-download/${requestId}`);
        const rawData = resDownload.data;

        const result = rawData.map((item) => {
          const contactId = Object.keys(item)[0];
          const data = item[contactId];
          const email = data.contactData?.email || '';

          const contactProps = {
            email, num_pedido: '', fecha_pedido: '', fecha_encuesta: '',
            pedidoRecibido: '', problemas: '', recogidaPedido: '', todoCorrecto: ''
          };

          for (const prop of (data.contactPropertiesData || [])) {
            if (prop.name in contactProps) contactProps[prop.name] = prop.value || '';
          }
          return contactProps;
        });

        if (result.length > 0) { contacts = result; break; }
      } catch (err) {
        console.warn('⚠️ Error en el intento:', err.message);
      }
      await new Promise(r => setTimeout(r, delay));
    }

    if (!contacts.length) throw new Error('⛔ No se pudo obtener el archivo después de varios intentos');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pedidos');

    worksheet.columns = [
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Nº Pedido', key: 'num_pedido', width: 15 },
      { header: 'Fecha Pedido', key: 'fecha_pedido', width: 20 },
      { header: 'Fecha Encuesta', key: 'fecha_encuesta', width: 20 },
      { header: 'Días de entrega', key: 'dias_entrega', width: 18 },
      { header: 'Pedido Recibido', key: 'pedidoRecibido', width: 20 },
      { header: 'Problemas', key: 'problemas', width: 20 },
      { header: 'Recogida Pedido', key: 'recogidaPedido', width: 20 },
      { header: 'Todo Correcto', key: 'todoCorrecto', width: 20 }
    ];

    for (const c of contacts) {
      let dias_entrega = '';
      let retraso = false;

      const parseFechaEuropea = (str) => {
        const [dd, mm, yyyy] = String(str).split('/');
        return new Date(`${yyyy}-${mm}-${dd}`);
      };

      if (c.fecha_pedido && c.fecha_encuesta) {
        const d1 = new Date(c.fecha_pedido);
        const d2 = c.fecha_encuesta.includes('/') ? parseFechaEuropea(c.fecha_encuesta) : new Date(c.fecha_encuesta);
        const diff = (d2 - d1) / (1000 * 60 * 60 * 24);
        dias_entrega = Math.floor(diff);
        if (dias_entrega > 7) retraso = true;
      }

      const row = worksheet.addRow({ ...c, dias_entrega });
      if (c.pedidoRecibido === 'no' || c.problemas === 'sí' || retraso) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000' } };
          cell.font = { color: { argb: 'FFFFFF' } };
        });
      }
    }

    const filename = `./reporte-pedidos-${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(filename);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: ['jcanton@silbon.es', 'clopez@silbon.es'],
      subject: '📦 Reporte semanal de pedidos - Salesmanago',
      text: 'Adjunto Excel con el resumen de pedidos exportados desde Salesmanago.',
      attachments: [{ filename: path.basename(filename), path: filename }]
    });

    console.log('📧 Excel enviado correctamente');
  } catch (err) {
    console.error('❌ Error en generateAndSendExcelReport:', err);
  }
}

// CRON: Ejecutar cada lunes a las 9:00
cron.schedule('0 9 * * 1', generateAndSendExcelReport);

// Test manual
app.get('/api/test-export-excel', async (_req, res) => {
  await generateAndSendExcelReport();
  res.send('✅ Exportación lanzada manualmente');
});

// Check props rápidas
app.get('/api/check-fecha-encuesta', async (_req, res) => {
  try {
    const exportRes = await axios.post(`${process.env.BASE_URL}/api/sm-export-tag`);
    const requestId = exportRes.data?.requestId;
    if (!requestId) throw new Error('❌ No se recibió requestId');

    const retries = 10;
    const delay = 10000;

    for (let i = 0; i < retries; i++) {
      try {
        const resDownload = await axios.get(`${process.env.BASE_URL}/api/sm-export-download/${requestId}`);
        const rawData = resDownload.data;

        const propsSet = new Set();
        for (const item of rawData) {
          const contactId = Object.keys(item)[0];
          const props = item[contactId].contactPropertiesData || [];
          for (const p of props) propsSet.add(p.name);
        }

        const allProps = Array.from(propsSet);
        const incluyeEncuesta = allProps.includes('fecha_encuesta');
        return res.json({ fecha_encuesta_presente: incluyeEncuesta, propiedades: allProps });
      } catch {
        console.warn('⏳ Archivo aún no disponible...');
      }
      await new Promise(r => setTimeout(r, delay));
    }

    throw new Error('⛔ Archivo no disponible tras varios intentos');
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Informe mensual (tu código tal cual, recortado aquí por brevedad)
async function generateAndSendMonthlyReport() { /* ... mismo que ya tienes ... */ }
cron.schedule('0 9 1 * *', generateAndSendMonthlyReport);
app.get('/api/test-monthly-report', async (_req, res) => {
  await generateAndSendMonthlyReport();
  res.send('✅ Informe mensual generado y enviado');
});

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'pedidos-clean', zendesk: true }));

// Sidecar Zendesk
app.post('/api/zendesk-contact', async (req, res) => {
  try {
    const { payload, errors } = validatePayload(req.body || {});
    if (errors.length) return res.status(400).json({ ok: false, error: 'validation_error', details: errors });
    if (typeof req.body?.website !== 'undefined' && String(req.body.website).trim() !== '') {
      return res.status(202).json({ ok: true, spam: true });
    }
    const json = await createZendeskTicket(payload);
    return res.status(200).json({ ok: true, ticket_id: json?.ticket?.id || null });
  } catch (e) {
    console.error('zendesk-contact error:', e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Endpoint manual para asignación por variante si lo necesitas
app.post('/api/assign-profile', assignProfile);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 Servidor escuchando en http://localhost:${PORT}`);
});

import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());


function generateSha(apiKey, clientId, apiSecret) {
  return crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');
}

// SHOPIFY - Obtener pedido por número
app.get('/api/order/:id', async (req, res) => {
  const orderNumber = req.params.id;

  try {
    const response = await axios.get(
      `${process.env.SHOPIFY_API_URL}.json?name=${orderNumber}`, // sin #
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const order = response.data.orders?.[0];
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    res.json({ order });

  } catch (error) {
    console.error(`Error al obtener pedido ${orderNumber}:`, error.message);
    res.status(500).json({ error: 'Error al obtener el pedido' });
  }
});

// Función para subir a Salesmanago
async function upsertOrderToSalesmanago(email, orderNumber, orderDate) {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = process.env.SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();
  const sha = generateSha(apiKey, clientId, apiSecret);

  const payload = {
    clientId,
    apiKey,
    sha,
    requestTime,
    owner,
    contact: { email },
    properties: {
      num_pedido: orderNumber,
      fecha_pedido: orderDate
    }
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



// endpoint para recibir datos de Salesmanago
app.post('/api/sm-upsert', async (req, res) => {
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const owner = process.env.SMANAGO_OWNER_EMAIL;
  const requestTime = Date.now();

  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  const data = {
    clientId,
    apiKey,
    sha,
    requestTime,
    owner,
    contact: {
      email: 'prueba@example.com',
      name: 'Prueba Test',
      state: 'PROSPECT',
    }
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


// endpoint para exportar contactos a Salesmanago con un tag específico
app.post('/api/sm-export-tag', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com'; // correo específico para esta exportación
  const requestTime = Date.now();

  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  const payload = {
    clientId,
    apiKey,
    requestTime,
    sha,
    owner,
    contacts: [
      { addresseeType: 'tag', value: 'LANDINGPAGE_RECEPCION_PEDIDO' }
    ],
    data: [
      { dataType: 'CONTACT' },
      { dataType: 'PROPERTIES' }
    ]
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

// endpoint para consultar el estado de una exportación
app.get('/api/sm-export-status/:requestId', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com'; // mismo owner
  const requestTime = Date.now();
  const requestId = req.params.requestId;

  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  const payload = {
    clientId,
    apiKey,
    requestTime,
    sha,
    owner,
    requestId
  };

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

// endpoint para descargar el archivo de contactos exportados
app.get('/api/sm-export-download/:requestId', async (req, res) => {
  const clientId = process.env.SMANAGO_CLIENT_ID;
  const apiKey = process.env.SMANAGO_API_KEY;
  const apiSecret = process.env.SMANAGO_API_SECRET;
  const owner = 'salesmanago@silbonshop.com';
  const requestTime = Date.now();
  const requestId = req.params.requestId;

  const sha = crypto
    .createHash('sha1')
    .update(apiKey + clientId + apiSecret)
    .digest('hex');

  const payload = {
    clientId,
    apiKey,
    requestTime,
    sha,
    owner,
    requestId
  };

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



// endpoint donde llama salesmanago para confirmar que se ha recibido el email
app.post('/api/sm-confirmed-received', async (req, res) => {
  const allowedIps = ['89.25.223.94', '89.25.223.95'];
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress?.replace('::ffff:', '');

  const { id, email } = req.body;

  if (!allowedIps.includes(ip)) {
    console.warn(`❌ IP no autorizada: ${ip}`);
    return res.status(403).json({ error: 'IP no autorizada' });
  }

  if (id !== 'ff9f1f0d-ffb7-4a00-9d84-999d2657f303') {
    console.warn(`❌ id (regla) inválido: ${id}`);
    return res.status(403).json({ error: 'id inválido' });
  }

  if (!email) {
    return res.status(400).json({ error: 'Email no proporcionado' });
  }

  try {
    const response = await axios.get(`${process.env.SHOPIFY_API_URL}.json?email=${email}`, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const order = response.data.orders?.[0];
    if (!order) {
      console.warn(`⚠️ No se encontró pedido para ${email}`);
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const orderNumber = order.name?.replace('#', '') || 'N/A';
    const orderDate = order.created_at?.split('T')[0] || '';

    // 🔁 Subir a Salesmanago
    const clientId = process.env.SMANAGO_CLIENT_ID;
    const apiKey = process.env.SMANAGO_API_KEY;
    const apiSecret = process.env.SMANAGO_API_SECRET;
    const owner = process.env.SMANAGO_OWNER_EMAIL;
    const requestTime = Date.now();
    const sha = crypto.createHash('sha1').update(apiKey + clientId + apiSecret).digest('hex');

    const payload = {
      clientId,
      apiKey,
      sha,
      requestTime,
      owner,
      contact: { email },
      properties: {
        num_pedido: orderNumber,
        fecha_pedido: orderDate
      }
    };

    const smRes = await axios.post('https://app3.salesmanago.com/api/contact/upsert', payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`✅ Pedido ${orderNumber} subido para ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`❌ Error procesando ${email}:`, err.response?.data || err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
});


// Función para generar y enviar Excel
async function generateAndSendExcelReport() {
  try {
    const exportRes = await axios.post(`${process.env.BASE_URL}/api/sm-export-tag`);
    const requestId = exportRes.data?.requestId;
    if (!requestId) throw new Error('No se recibió requestId');

    console.log('⏳ Export solicitado. Punto de partida.');

    let retries = 10;
    let delay = 10000; // 10 segundos
    let contacts = [];

    for (let i = 0; i < retries; i++) {
      console.log(`🔁 Intento ${i + 1}/${retries}`);
      const requestTime = Date.now();
      const sha = crypto.createHash('sha1')
        .update(process.env.SMANAGO_API_KEY + process.env.SMANAGO_CLIENT_ID + process.env.SMANAGO_API_SECRET)
        .digest('hex');

      const statusRes = await axios.post('https://app3.salesmanago.pl/api/job/status', {
        clientId: process.env.SMANAGO_CLIENT_ID,
        apiKey: process.env.SMANAGO_API_KEY,
        sha,
        requestTime,
        owner: process.env.SMANAGO_OWNER_EMAIL,
        requestId
      }, { headers: { 'Content-Type': 'application/json' } });

      const fileUrl = statusRes.data?.fileUrl;
      console.log('📎 fileUrl:', fileUrl);

      if (fileUrl) {
        // Descarga el JSON
        const fileRes = await axios.get(fileUrl);
        const downloaded = fileRes.data;
        contacts = downloaded.contactData ? [downloaded] : (downloaded.contacts || []);
        if (contacts.length > 0) {
          console.log('✅ Contacts descargados:', contacts.length);
          break;
        }
      }
      await new Promise(r => setTimeout(r, delay));
    }

    if (contacts.length === 0) {
      throw new Error('⛔ No se pudo descargar datos tras varios intentos');
    }

    // Crear Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pedidos');
    ws.columns = [
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Nº Pedido', key: 'num_pedido', width: 15 },
      { header: 'Fecha Pedido', key: 'fecha_pedido', width: 15 },
      { header: 'Pedido Recibido', key: 'pedidoRecibido', width: 15 },
      { header: 'Problemas', key: 'problemas', width: 15 },
      { header: 'Recogida Pedido', key: 'recogidaPedido', width: 15 },
      { header: 'Todo Correcto', key: 'todoCorrecto', width: 15 },
      { header: 'Días transcurridos', key: 'dias', width: 15 }
    ];

    contacts.forEach(c => {
      const cd = c.contactData || {};
      const props = c.contactPropertiesData || {};
      const fecha = props.fecha_pedido?.value;
      const rec = props.pedidoRecibido?.value;
      const prob = props.problemas?.value;

      let dias = '';
      if (fecha && rec?.toLowerCase() === 'sí') {
        dias = Math.floor((new Date() - new Date(fecha)) / (1000 * 60 * 60 * 24));
      }

      const row = ws.addRow({
        email: cd.email || '',
        num_pedido: props.num_pedido?.value || '',
        fecha_pedido: fecha || '',
        pedidoRecibido: rec || '',
        problemas: prob || '',
        recogidaPedido: props.recogidaPedido?.value || '',
        todoCorrecto: props.todoCorrecto?.value || '',
        dias
      });

      if (rec?.toLowerCase() === 'no' || prob?.toLowerCase() === 'sí') {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000' } };
          cell.font = { color: { argb: 'FFFFFF' } };
        });
      }
    });

    const fname = `./reporte-pedidos-${Date.now()}.xlsx`;
    await wb.xlsx.writeFile(fname);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: 'jcanton@silbon.es',
      subject: '📦 Reporte de pedidos semanal',
      text: 'Adjunto Excel de pedidos.',
      attachments: [{ filename: path.basename(fname), path: fname }]
    });

    console.log('📧 Excel enviado correctamente');
  } catch (err) {
    console.error('❌ Error en reporte:', err.message || err);
  }
}


// CRON: Ejecutar cada lunes a las 9:00
cron.schedule('0 9 * * 1', generateAndSendExcelReport);

// Ruta manual para lanzar el Excel desde Postman
app.get('/api/test-export-excel', async (req, res) => {
  await generateAndSendExcelReport();
  res.send('✅ Exportación lanzada manualmente');
});



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 Servidor escuchando en http://localhost:${PORT}`);
});
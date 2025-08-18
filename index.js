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


// Función para mostrar datos del Excel desde tu endpoint custom
async function generateAndSendExcelReport() {
  try {
    const exportRes = await axios.post(`${process.env.BASE_URL}/api/sm-export-tag`);
    const requestId = exportRes.data?.requestId;
    if (!requestId) throw new Error('❌ No se recibió requestId');

    console.log(`📤 Exportación solicitada. requestId: ${requestId}`);
    console.log('⏳ Esperando archivo...');

    const retries = 10;
    const delay = 10000;
    let contacts = [];

    for (let i = 0; i < retries; i++) {
      console.log(`🔁 Intento ${i + 1}/${retries}...`);
      try {
        const resDownload = await axios.get(`${process.env.BASE_URL}/api/sm-export-download/${requestId}`);
        const rawData = resDownload.data;

        const result = rawData.map((item) => {
          const contactId = Object.keys(item)[0];
          const data = item[contactId];
          const email = data.contactData?.email || '';

          const contactProps = {
            email,
            num_pedido: '',
            fecha_pedido: '',
            fecha_encuesta: '',
            pedidoRecibido: '',
            problemas: '',
            recogidaPedido: '',
            todoCorrecto: ''
          };

          const propsArray = data.contactPropertiesData || [];

          for (const prop of propsArray) {
            if (prop.name in contactProps) {
              contactProps[prop.name] = prop.value || '';
            }
          }

          return contactProps;
        });

        if (result.length > 0) {
          contacts = result;
          break;
        }

      } catch (err) {
        console.warn('⚠️ Error en el intento:', err.message);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (contacts.length === 0) {
      throw new Error('⛔ No se pudo obtener el archivo después de varios intentos');
    }

    // 📁 Crear Excel
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

    for (const contact of contacts) {
      const fechaPedido = contact.fecha_pedido;
      const fechaEncuesta = contact.fecha_encuesta;

      // ✅ Declaración correcta (fuera del if)
      let dias_entrega = '';
      let retraso = false;

      // 👇 esta función puedes declararla arriba en el archivo si prefieres
      function parseFechaEuropea(str) {
        const [dd, mm, yyyy] = str.split('/');
        return new Date(`${yyyy}-${mm}-${dd}`);
      }

      if (fechaPedido && fechaEncuesta) {
        const fechaPedidoDate = new Date(fechaPedido);
        const fechaEncuestaDate = fechaEncuesta.includes('/')
          ? parseFechaEuropea(fechaEncuesta)
          : new Date(fechaEncuesta);

        const diff = (fechaEncuestaDate - fechaPedidoDate) / (1000 * 60 * 60 * 24);
        dias_entrega = Math.floor(diff);
        if (dias_entrega > 7) retraso = true;
      }

      const row = worksheet.addRow({
        ...contact,
        fecha_encuesta: fechaEncuesta || '',
        dias_entrega // ✅ ahora sí tiene el valor calculado
      });

      if (contact.pedidoRecibido === 'no' || contact.problemas === 'sí' || retraso) {
        row.eachCell(cell => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0000' }
          };
          cell.font = { color: { argb: 'FFFFFF' } };
        });
      }
    }



    const filename = `./reporte-pedidos-${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(filename);

    // 📧 Enviar por correo
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: 'jcanton@silbon.es',
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

// Ruta manual para lanzar el Excel desde Postman
app.get('/api/test-export-excel', async (req, res) => {
  await generateAndSendExcelReport();
  res.send('✅ Exportación lanzada manualmente');
});

//prueba de verificación rapida 
app.get('/api/check-fecha-encuesta', async (req, res) => {
  try {
    // 1. Lanzamos exportación
    const exportRes = await axios.post(`${process.env.BASE_URL}/api/sm-export-tag`);
    const requestId = exportRes.data?.requestId;
    if (!requestId) throw new Error('❌ No se recibió requestId');

    console.log(`📤 Exportación lanzada: ${requestId}`);

    // 2. Esperamos el archivo (máximo 10 intentos)
    const retries = 10;
    const delay = 10000;

    for (let i = 0; i < retries; i++) {
      console.log(`🔁 Esperando archivo... intento ${i + 1}/${retries}`);
      try {
        const resDownload = await axios.get(`${process.env.BASE_URL}/api/sm-export-download/${requestId}`);
        const rawData = resDownload.data;

        const propsSet = new Set();

        for (const item of rawData) {
          const contactId = Object.keys(item)[0];
          const props = item[contactId].contactPropertiesData || [];
          for (const prop of props) {
            propsSet.add(prop.name);
          }
        }

        const allProps = Array.from(propsSet);
        console.log('🧾 Propiedades encontradas:', allProps);

        const incluyeEncuesta = allProps.includes('fecha_encuesta');
        return res.json({
          fecha_encuesta_presente: incluyeEncuesta,
          propiedades: allProps
        });

      } catch (err) {
        console.warn('⏳ Archivo aún no disponible...');
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw new Error('⛔ Archivo no disponible tras varios intentos');

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


async function generateAndSendMonthlyReport() {
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
          const props = {
            email, num_pedido: '', fecha_pedido: '', fecha_encuesta: '',
            pedidoRecibido: '', problemas: '', recogidaPedido: '', todoCorrecto: ''
          };
          for (const p of data.contactPropertiesData || []) {
            if (p.name in props) props[p.name] = p.value || '';
          }
          return props;
        });

        if (result.length > 0) {
          contacts = result;
          break;
        }
      } catch (err) {
        console.warn(`⚠️ Intento ${i + 1} fallido: ${err.message}`);
      }
      await new Promise(res => setTimeout(res, delay));
    }

    if (contacts.length === 0) throw new Error('⛔ No se pudo obtener el archivo');

    const hoy = new Date();
    const currentMonth = hoy.getMonth();
    const currentYear = hoy.getFullYear();
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    function parseFecha(str) {
      const [dd, mm, yyyy] = str.split('/');
      return new Date(`${yyyy}-${mm}-${dd}`);
    }

    const filteredContacts = contacts.filter(c => {
      if (!c.fecha_pedido) return false;
      const d = new Date(c.fecha_pedido);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });

    // Excel
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

    let totalPedidos = 0, recibidos = 0, noRecibidos = 0, sumaDias = 0, totalConEncuesta = 0;

    for (const c of filteredContacts) {
      let dias_entrega = '';
      let retraso = false;

      if (c.fecha_pedido && c.fecha_encuesta) {
        const d1 = new Date(c.fecha_pedido);
        const d2 = c.fecha_encuesta.includes('/') ? parseFecha(c.fecha_encuesta) : new Date(c.fecha_encuesta);
        const diff = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
        dias_entrega = diff;
        sumaDias += diff;
        totalConEncuesta++;
        if (diff > 7) retraso = true;
      }

      const row = worksheet.addRow({ ...c, dias_entrega });

      if (c.pedidoRecibido === 'no') noRecibidos++;
      if (c.pedidoRecibido === 'si') recibidos++;
      totalPedidos++;

      if (c.pedidoRecibido === 'no' || c.problemas === 'sí' || retraso) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000' } };
          cell.font = { color: { argb: 'FFFFFF' } };
        });
      }
    }

    const excelPath = `./reporte-pedidos-${Date.now()}.xlsx`;
    await workbook.xlsx.writeFile(excelPath);

    // Gráfica donut
    const donutChart = new QuickChart();
    donutChart.setWidth(500).setHeight(300);
    donutChart.setConfig({
      type: 'doughnut',
      data: {
        labels: [`Sí (${recibidos})`, `No (${noRecibidos})`],
        datasets: [{
          data: [recibidos, noRecibidos],
          backgroundColor: ['#36A2EB', '#FF6384']
        }]
      },
      options: {
        plugins: {
          legend: { position: 'top' },
          datalabels: {
            display: true,
            formatter: (value, ctx) => {
              const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
              const pct = ((value / total) * 100).toFixed(1);
              return `${value} (${pct}%)`;
            }
          }
        }
      }
    });
    const donut = await donutChart.toBinary();

    // Gráfica de barras por mes
    const monthly = {};
    contacts.forEach(c => {
      const d = new Date(c.fecha_pedido);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { si: 0, no: 0 };
      if (c.pedidoRecibido === 'si') monthly[key].si++;
      if (c.pedidoRecibido === 'no') monthly[key].no++;
    });

    const barChart = new QuickChart();
    barChart.setWidth(800).setHeight(300);
    barChart.setConfig({
      type: 'bar',
      data: {
        labels: Object.keys(monthly),
        datasets: [
          { label: 'Sí', data: Object.values(monthly).map(x => x.si), backgroundColor: '#36A2EB' },
          { label: 'No', data: Object.values(monthly).map(x => x.no), backgroundColor: '#FF6384' }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'top' }
        },
        scales: {
          x: { stacked: true },
          y: { beginAtZero: true }
        }
      }
    });
    const bar = await barChart.toBinary();

    const doc = new PDFDocument();
    const pdfPath = `./reporte-pedidos-${Date.now()}.pdf`;
    doc.pipe(fs.createWriteStream(pdfPath));

    // Cargar el logo desde URL
    const logoUrl = 'https://cdn.shopify.com/s/files/1/0794/1311/7206/files/footer.png?v=1739572304';
    const logoBuffer = await axios.get(logoUrl, { responseType: 'arraybuffer' }).then(res => res.data);

    doc.image(logoBuffer, 50, 30, { width: 120 });


    doc.fontSize(18).text('Informe mensual de pedidos', { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Respuestas formulario: ${totalPedidos}`);
    doc.text(`Recibidos: ${recibidos}`);
    doc.text(`No recibidos: ${noRecibidos}`);

    const startOfMonth = new Date(prevYear, prevMonth, 1);
    const endOfMonth = new Date(prevYear, prevMonth + 1, 0);
    doc.moveDown().text(`Rango de fechas: ${startOfMonth.toLocaleDateString('es-ES')} a ${endOfMonth.toLocaleDateString('es-ES')}`);
    doc.moveDown().image(donut, { fit: [500, 300], align: 'center' }).moveDown();
    doc.image(bar, { fit: [500, 300], align: 'center' });

    // Footer profesional
    doc.moveDown(3);
    doc.fontSize(10)
      .fillColor('#888888')
      .text('Este informe ha sido generado automáticamente mediante una solución desarrollada por Javier García-Rojo Cantón. Todos los derechos reservados.', {
        align: 'center'
      });


    doc.end();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: 'jcanton@silbon.es',
      subject: '📦 Informe mensual de pedidos - Salesmanago',
      text: 'Adjunto Excel y PDF con el resumen de pedidos del mes anterior.',
      attachments: [
        { filename: path.basename(excelPath), path: excelPath },
        { filename: path.basename(pdfPath), path: pdfPath }
      ]
    });

    console.log('📧 Informe mensual enviado correctamente');
  } catch (err) {
    console.error('❌ Error en generateAndSendMonthlyReport:', err);
  }
}

// CRON cada mes el día 1 a las 9:00
cron.schedule('0 9 1 * *', generateAndSendMonthlyReport);

// Ruta manual para lanzar el informe mensual
app.get('/api/test-monthly-report', async (req, res) => {
  await generateAndSendMonthlyReport();
  res.send('✅ Informe mensual generado y enviado');
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 Servidor escuchando en http://localhost:${PORT}`);
});
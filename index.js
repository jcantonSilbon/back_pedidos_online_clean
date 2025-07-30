import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';


dotenv.config();
const app = express();
app.use(cors());

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







// endpoint donde llama salesmanago para confirmar que se ha recibido el email
app.post('/api/sm-confirmed-received', (req, res) => {
  const allowedIps = ['89.25.223.94', '89.25.223.95'];
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress?.replace('::ffff:', '');

  const { ruleId, contacts } = req.body;

  if (!allowedIps.includes(ip)) {
    console.warn(`❌ IP no autorizada: ${ip}`);
    return res.status(403).json({ error: 'IP no autorizada' });
  }

  if (ruleId !== 'ff9f1f0d-ffb7-4a00-9d84-999d2657f303') {
    console.warn(`❌ ruleId inválido: ${ruleId}`);
    return res.status(403).json({ error: 'ruleId inválido' });
  }

  if (!contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Formato de contactos no válido' });
  }

  // 🔍 Aquí podrías cruzar con pedidos si quieres
  const orders = contacts.map(contact => ({
    email: contact.email,
    receivedAt: new Date().toISOString(),
    status: '✅ recibido'
  }));

  console.log('📥 Datos recibidos:', orders);

  return res.status(200).json({ success: true, received: orders.length });
});



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 Servidor escuchando en http://localhost:${PORT}`);
});
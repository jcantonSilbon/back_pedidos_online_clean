const crypto = require('crypto');

const apiKey = 'wg04OuyP5k74dQh0S7fUC3tJ3PZVk8zL7bibiJio6yAwmNH82Avv1AzZ49FCJ';
const clientId = 'japescuezo@silbon.es';
const requestTime = 1723786073333;

const sha = crypto
  .createHash('sha1') // ¡Aquí está la clave! SHA-1
  .update(apiKey + clientId + requestTime)
  .digest('hex');

console.log('SHA generado:', sha);

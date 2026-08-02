const http = require('http');
const data = JSON.stringify({ username: 'Stanley', pin: '2468' });
const opts = {
  method: 'POST',
  hostname: 'localhost',
  port: 4000,
  path: '/api/login',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
};
const req = http.request(opts, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => console.log('RESPONSE:', b));
});
req.on('error', (e) => console.error('ERROR:', e));
req.write(data);
req.end();

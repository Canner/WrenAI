/* eslint-disable @typescript-eslint/no-var-requires */
const { createServer } = require('https');
const fs = require('fs');
const mkcert = require('./mkcert');
const { parse } = require('url');
const path = require('path');
const next = require('next');

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || '0.0.0.0';

const certPath = path.join(__dirname, '../certificates/localhost.pem');
const keyPath = path.join(__dirname, '../certificates/localhost-key.pem');

const app = next({
  dev: false,
  hostname,
  port: currentPort,
});

const handle = app.getRequestHandler();
app.prepare().then(async () => {
  if (!fs.existsSync(certPath)) {
    await mkcert.createSelfSignedCertificate();
  }

  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  createServer(httpsOptions, async (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(currentPort, async () => {
    console.log(`> Ready on https://${hostname}:${currentPort}`);
  });
});

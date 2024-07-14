const { createServer } = require('https');
const mkcert = require('mkcert');
const fs = require('fs');
const { parse } = require('url');
const path = require('path');
const next = require('next');

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

const app = next({
  dev: false,
  hostname,
  port: currentPort,
});

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'certificates/localhost-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certificates/localhost.pem')),
}

const handle = app.getRequestHandler();
app.prepare().then(async () => {
  createServer(httpsOptions, async (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(currentPort, async () => {
    console.log(`> Ready on https://${hostname}:${currentPort}`);
  });
});

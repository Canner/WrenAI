#!/usr/bin/env node
// Static file server with CORS + Range request + MIME types.
// Usage: node examples/serve.mjs [port]
//
// Serves the wren-core-wasm root directory so both pkg/ and examples/ are accessible.
// URL mode requires Range request support for DataFusion to read remote Parquet.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.argv[2] || 8787;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.json': 'application/json; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.csv':  'text/csv; charset=utf-8',
    '.tsv':  'text/tab-separated-values; charset=utf-8',
    '.parquet': 'application/octet-stream',
};

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Accept-Ranges': 'bytes',
};

createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

    try {
        const reqPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const filePath = resolve(join(ROOT, reqPath));
        // Reject path traversal (e.g. `..`) that escapes ROOT
        const rel = relative(ROOT, filePath);
        if (rel.startsWith('..')) {
            return res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
        }
        const info = await stat(filePath);
        const contentType = MIME[extname(filePath)] || 'application/octet-stream';
        const size = info.size;

        // Handle Range requests (required for DataFusion Parquet reading)
        const rangeHeader = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
        if (rangeHeader) {
            const start = +rangeHeader[1];
            const end = rangeHeader[2] ? +rangeHeader[2] : size - 1;
            res.writeHead(206, {
                ...CORS,
                'Content-Type': contentType,
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Content-Length': end - start + 1,
            });
            createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                ...CORS,
                'Content-Type': contentType,
                'Content-Length': size,
            });
            createReadStream(filePath).pipe(res);
        }
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
}).listen(PORT, () => {
    console.log(`Serving on http://localhost:${PORT}`);
    console.log(`  inline demo:      http://localhost:${PORT}/examples/inline.html`);
    console.log(`  url-mode demo:    http://localhost:${PORT}/examples/url-mode.html`);
    console.log(`  cdn demo:         http://localhost:${PORT}/examples/test-cdn.html`);
    console.log(`  cube quickstart:  http://localhost:${PORT}/examples/cube-quickstart.html`);
    console.log(`  cube explorer:    http://localhost:${PORT}/examples/cube-explorer.html`);
    console.log(`  csv quickstart:   http://localhost:${PORT}/examples/csv-quickstart.html`);
});

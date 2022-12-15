import http, { STATUS_CODES } from 'http';
import https from 'https';

import { certificate, privateKey } from './certs';

export const httpServer = http.createServer(handler);

export const httpsServer = https.createServer({
    cert: certificate,
    key: privateKey,
}, handler);

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    const isHttps = !!(req.connection as any).encrypted;
    const bodyChunks = [];
    for await (const chunk of req) {
        bodyChunks.push(chunk);
    }
    res.writeHead(200, STATUS_CODES[200], {
        'content-type': 'text/plain'
    });
    const responseLines = [
        `You requested ${req.method} ${req.url} over ${isHttps ? 'https' : 'http'}`,
        Buffer.concat(bodyChunks).toString('utf-8'),
    ];
    res.end(responseLines.filter(Boolean).join('\n'));
}

export async function startServer(server: http.Server, port: number) {
    await new Promise<void>((resolve, reject) => {
        server.listen(port, resolve).on('error', reject);
    });
}

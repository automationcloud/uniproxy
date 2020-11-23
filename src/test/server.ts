import http, { STATUS_CODES } from 'http';
import https from 'https';
import { certificate, privateKey } from './certs';

export const httpServer = http.createServer(handler);

export const httpsServer = https.createServer({
    cert: certificate,
    key: privateKey,
}, handler);

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, STATUS_CODES[200], {
        'content-type': 'text/plain'
    });
    res.end(`You requested ${req.url}`);
}

export async function startServer(server: http.Server, port: number) {
    await new Promise((resolve, reject) => {
        server.listen(port, resolve).on('error', reject);
    });
}

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';

export class HttpsProxyAgent extends https.Agent {
    constructor(readonly hostname: string, readonly port: number, options: https.AgentOptions = {}) {
        super({
            keepAlive: false,
            timeout: 60000,
            ...options
        });
    }

    createConnection(options: any, cb: (err: Error | null, socket?: net.Socket) => void) {
        const connectReq = http.request({
            method: 'connect',
            hostname: this.hostname,
            port: this.port,
            path: [options.host, options.port].join(':'),
            headers: {
                host: options.host,
            },
        });
        connectReq.on('connect', (res: http.IncomingMessage, socket: net.Socket) => {
            if (res.statusCode !== 200) {
                const err = new ProxyConnectionFailed(`proxy returned ${res.statusCode} ${res.statusMessage}`);
                cb(err);
                return;
            }
            const tlsSocket = tls.connect({
                host: options.host,
                port: options.port,
                socket,
                ALPNProtocols: ['http/1.1'],
                ca: this.options.ca,
            });
            cb(null, tlsSocket);
        });
        connectReq.on('error', (err: any) => cb(err));
        connectReq.end();
    }
}

export class HttpProxyAgent extends http.Agent {
    constructor(readonly hostname: string, readonly port: number, options: http.AgentOptions = {}) {
        super({
            keepAlive: false,
            timeout: 60000,
            ...options,
        });
    }

    addRequest(req: http.ClientRequest, options: any) {
        req.shouldKeepAlive = false;
        (req as any).path = options.href;
        const socket = this.createConnection(options);
        req.onSocket(socket);
    }

    createConnection(_options: any) {
        const socket = net.createConnection({
            host: this.hostname,
            port: this.port,
        });
        return socket;
    }
}

export class ProxyConnectionFailed extends Error {
    constructor(reason: string) {
        super(`Proxy connection failed: ${reason}`);
    }
}

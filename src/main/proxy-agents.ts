import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';

import { makeBasicAuthHeader, ProxyConnectionFailed, ProxyUpstream } from './commons';

/**
 * Quick-and-simple agent for issuing HTTPS requests via a proxy.
 */
export class HttpsProxyAgent extends https.Agent {
    constructor(
        readonly upstream: ProxyUpstream,
        options: https.AgentOptions = {}
    ) {
        super({
            keepAlive: false,
            timeout: 60000,
            ...options
        });
    }

    createConnection(options: any, cb: (err: Error | null, socket?: net.Socket) => void) {
        const [hostname, port] = this.upstream.host.split(':');
        const request = this.upstream.useHttps ? https.request : http.request;
        const connectReq = request({
            method: 'connect',
            hostname,
            port: Number(port) || 80,
            path: [options.host, options.port].join(':'),
            headers: {
                host: options.host,
            },
            ca: this.options.ca,
            ALPNProtocols: ['http/1.1'],
            servername: hostname,
        } as any);
        if (this.upstream.username || this.upstream.password) {
            connectReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(this.upstream));
        }
        connectReq.on('connect', (res: http.IncomingMessage, socket: net.Socket) => {
            if (res.statusCode !== 200) {
                const err = new ProxyConnectionFailed(this.upstream, res.statusCode!);
                return cb(err);
            }
            const tlsSocket = tls.connect({
                host: options.host,
                port: options.port,
                socket,
                ALPNProtocols: ['http/1.1'],
                servername: options.host,
                ca: this.options.ca,
            });
            tlsSocket.on('error', err => cb(err));
            cb(null, tlsSocket);
        });
        connectReq.on('error', (err: any) => cb(err));
        connectReq.end();
    }
}

/**
 * Quick-and-simple agent for issuing HTTP requests via a proxy.
 *
 * Note: ProxyAuthorization is currently not supported.
 */
export class HttpProxyAgent extends http.Agent {
    constructor(
        readonly upstream: ProxyUpstream,
        options: http.AgentOptions = {}
    ) {
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
        if (this.upstream.username || this.upstream.password) {
            req.setHeader('Proxy-Authorization', makeBasicAuthHeader(this.upstream));
        }
        req.onSocket(socket);
    }

    createConnection(_options: any) {
        const [hostname, port] = this.upstream.host.split(':');
        const socket = net.createConnection({
            host: hostname,
            port: Number(port) || 80,
        });
        return socket;
    }
}

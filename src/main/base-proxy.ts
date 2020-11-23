// Copyright 2020 UBIO Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import http, { STATUS_CODES } from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { EventEmitter } from 'events';
import { makeBasicAuthHeader, ProxyConfig, ProxyConnectionFailed } from './commons';

/**
 * Base class for implementing proxies.
 *
 * This class features an HTTP server accepting both HTTP and HTTPS incoming traffic,
 * and routing such traffic either to a target destination (i.e. the website),
 * or to the next proxy in chain (aka "downstream" proxy).
 */
export abstract class BaseProxy extends EventEmitter {
    protected server: http.Server | null = null;
    protected clientSockets: Set<net.Socket> = new Set();

    constructor() {
        super();
    }

    /**
     * The hook for implementing routing logic per connection.
     *
     * This method is invoked either from CONNECT request handler (for SSL proxying)
     * or from HTTP request handler (for non-SSL proxying), prior to establishing the onward connection.
     *
     * If the method returns `null` the direct connection is established to the target `host`;
     * otherwise the returned downstream information is used to establish an onward connection
     * to the downstream proxy.
     */
    abstract matchRoute(host: string): ProxyConfig | null;

    /**
     * Returns the list of CA certificates chain to use when issuing HTTPS requests.
     * Override this to provide custom certificates (e.g. to use self-signed or custom CAs).
     */
    getCACertificates(): string[] {
        return [...tls.rootCertificates];
    }

    /**
     * Starts a proxy server on specified port.
     */
    async start(
        port: number,
        hostname: string = '127.0.0.1',
        options: http.ServerOptions = { insecureHTTPParser: true, maxHeaderSize: 65535 },
    ) {
        await new Promise((resolve, reject) => {
            this.server = http
                .createServer(options)
                .on('connection', socket => this.onConnection(socket))
                .on('request', (req, res) => this.onRequest(req, res))
                .on('connect', (req, socket) => this.onConnect(req, socket))
                .on('close', () => (this.server = null))
                .listen(port, hostname);
            this.server.on('listening', () => {
                return resolve();
            });
            this.server.on('error', error => {
                return reject(error);
            });
        });
    }

    /**
     * Shuts down the proxy server.
     *
     * @param force if `true`, forcibly shuts all established client connections.
     */
    async shutdown(force: boolean = false) {
        return new Promise(resolve => {
            if (force) {
                this.closeAllSockets();
            }
            if (this.server) {
                this.server.once('close', resolve);
                this.server.close();
                this.server = null;
            } else {
                resolve();
            }
        });
    }

    isRunning() {
        return this.server != null;
    }

    getServerAddress(): string {
        return (this.server?.address() as net.AddressInfo)?.address ?? '';
    }

    getServerPort(): number {
        return (this.server?.address() as net.AddressInfo)?.port ?? 0;
    }

    /**
     * Forcibly closes established client connections.
     *
     * This results in failing in-flight requests with ECONNRESET, so shouldn't be used
     * in the middle of http conversation.
     */
    closeAllSockets() {
        for (const socket of this.clientSockets) {
            socket.destroy();
        }
    }

    /**
     * Tracks established connections, so that they can be forcibly closed
     * by invoking `closeAllSockets`.
     */
    protected onConnection(socket: net.Socket) {
        this.clientSockets.add(socket);
        socket.once('close', () => this.clientSockets.delete(socket));
    }

    // HTTP

    protected onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const { host } = new URL(req.url!);
        const downstream = this.matchRoute(host);
        const fwdReq = downstream ? this.createProxyHttpRequest(req, downstream) : this.createDirectHttpRequest(req);
        fwdReq.on('error', (err: CustomError) => {
            err.details = { initiator: 'httpForwardedRequest', ...err.details };
            this.emit('error', err);
            res.writeHead(599);
            res.end();
        });
        fwdReq.on('response', fwdRes => {
            if (fwdRes.statusCode != null) {
                res.writeHead(fwdRes.statusCode, fwdRes.headers);
                fwdRes.pipe(res);
            }
        });
        req.pipe(fwdReq);
    }

    protected createProxyHttpRequest(req: http.IncomingMessage, downstream: ProxyConfig): http.ClientRequest {
        const [hostname, port] = downstream.host.split(':');
        const options = {
            hostname,
            port,
            path: req.url,
            method: req.method,
            headers: req.headers,
        };
        const fwdReq = downstream.useHttps ?
            https.request({ ...options, ca: this.getCACertificates() }) :
            http.request(options);
        if (downstream.username || downstream.password) {
            fwdReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(downstream));
        }
        return fwdReq;
    }

    protected createDirectHttpRequest(req: http.IncomingMessage): http.ClientRequest {
        const { hostname, port = 80, pathname, search } = new URL(req.url!);
        return http.request({
            hostname,
            port,
            path: pathname + search,
            method: req.method,
            headers: req.headers,
        });
    }

    // HTTPS

    protected async onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        try {
            // Note: CONNECT request's url always contains Host (hostname:port)
            const host = req.url ?? '';
            const downstream = this.matchRoute(host);
            const remoteSocket = downstream ?
                await this.createSslProxyConnection(host, downstream) :
                await this.createSslDirectConnection(host);
            clientSocket.write(`HTTP/${req.httpVersion} 200 OK\r\n\r\n`);
            remoteSocket.pipe(clientSocket);
            clientSocket.pipe(remoteSocket);
        } catch (error) {
            this.emit('error', error);
            const statusCode = (error as any).details?.statusCode ?? 502;
            const statusText = STATUS_CODES[statusCode];
            clientSocket.write(`HTTP/${req.httpVersion} ${statusCode} ${statusText}\r\n\r\n`);
            clientSocket.end();
        }
    }

    /**
     * Creates a connection to `targetHost` using specified `downstream` proxy.
     */
    async createSslProxyConnection(targetHost: string, downstream: ProxyConfig): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const connectReq = this.createDownstreamConnectReq(targetHost, downstream);
            connectReq.on('error', reject);
            connectReq.on('connect', (res: http.IncomingMessage, remoteSocket: net.Socket) => {
                if ((res.statusCode || 599) >= 400) {
                    const error = new ProxyConnectionFailed(`proxy returned ${res.statusCode}`, {
                        proxy: downstream,
                        statusCode: res.statusCode
                    });
                    reject(error);
                }
                resolve(remoteSocket);
            });
            connectReq.end();
        });
    }

    /**
     * Creates a connection to `targetHost` directly (without proxy).
     */
    async createSslDirectConnection(targetHost: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const url = new URL('https://' + targetHost);
            const port = Number(url.port) || 443;
            const remoteSocket = net.connect(port, url.hostname);
            remoteSocket.once('error', reject);
            remoteSocket.once('connect', () => resolve(remoteSocket));
        });
    }

    protected createDownstreamConnectReq(targetHost: string, downstream: ProxyConfig): http.ClientRequest {
        const { useHttps = true } = downstream;
        const [hostname, port] = downstream.host.split(':');
        const request = useHttps ? https.request : http.request;
        const connectReq = request({
            hostname,
            port,
            path: targetHost,
            method: 'CONNECT',
            headers: { host: targetHost },
            timeout: 10000,
            ca: this.getCACertificates(),
            ALPNProtocols: ['http/1.1'],
        } as any);
        if (downstream.username || downstream.password) {
            connectReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(downstream));
        }
        return connectReq;
    }

}

interface CustomError {
    details: any;
}

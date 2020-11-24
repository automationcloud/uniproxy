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
import { pipeline } from 'stream';
import { promisify } from 'util';
import { makeBasicAuthHeader, ProxyConfig, ProxyConnectionFailed } from './commons';

const pipelineAsync = promisify(pipeline);

/**
 * Base class for implementing proxies.
 *
 * This class features an HTTP server accepting both HTTP and HTTPS incoming traffic,
 * and routing such traffic either to a target destination (i.e. the website),
 * or to the next proxy in chain (aka "upstream" proxy).
 */
export class BaseProxy {
    protected server: http.Server | null = null;
    protected clientSockets: Set<net.Socket> = new Set();

    upstreamProxy: ProxyConfig | null = null;

    /**
     * The hook for implementing routing logic per connection.
     *
     * This method is invoked either from CONNECT request handler (for SSL proxying)
     * or from HTTP request handler (for non-SSL proxying), prior to establishing the onward connection.
     *
     * If the method returns `null` the direct connection is established to the target `host`;
     * otherwise the returned upstream information is used to establish an onward connection
     * to the upstream proxy.
     *
     * By default, it returns a `upstreamProxy` all the time.
     */
    matchRoute(_host: string): ProxyConfig | null {
        return this.upstreamProxy;
    }

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

    async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            const { host } = new URL(req.url!);
            const upstream = this.matchRoute(host);
            const fwdReq = upstream ?
                this.createProxyHttpRequest(req, upstream) :
                this.createDirectHttpRequest(req);
            req.pipe(fwdReq);
            const fwdRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
                fwdReq.once('error', reject);
                fwdReq.once('response', fwdRes => resolve(fwdRes));
            });
            res.writeHead(fwdRes.statusCode ?? 599, fwdRes.headers);
            fwdRes.pipe(res);
        } catch (error) {
            // TODO handle error
            res.writeHead(599);
            res.end();
        }
    }

    protected createProxyHttpRequest(req: http.IncomingMessage, proxy: ProxyConfig): http.ClientRequest {
        const [hostname, port] = proxy.host.split(':');
        const options = {
            hostname,
            port,
            path: req.url,
            method: req.method,
            headers: req.headers,
        };
        const fwdReq = proxy.useHttps ?
            https.request({ ...options, ca: this.getCACertificates() }) :
            http.request(options);
        if (proxy.username || proxy.password) {
            fwdReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(proxy));
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

    async onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        try {
            // Note: CONNECT request's url always contains Host (hostname:port)
            const targetHost = req.url ?? '';
            const upstream = this.matchRoute(targetHost);
            const remoteSocket = await this.createSslConnection(targetHost, upstream);
            clientSocket.write(`HTTP/${req.httpVersion} 200 OK\r\n\r\n`);
            await Promise.all([
                pipelineAsync(remoteSocket, clientSocket),
                pipelineAsync(clientSocket, remoteSocket),
            ]);
        } catch (error) {
            // TODO handle error
            const statusCode = (error as any).details?.statusCode ?? 502;
            const statusText = STATUS_CODES[statusCode];
            try {
                clientSocket.write(`HTTP/${req.httpVersion} ${statusCode} ${statusText}\r\n\r\n`);
                clientSocket.end();
            } finally {
                clientSocket.destroy();
            }
        }
    }

    /**
     * Creates an onward connection to `targetHost` either directly or via upstream `proxy`.
     */
    async createSslConnection(targetHost: string, proxy: ProxyConfig | null) {
        return proxy ? await this.createSslProxyConnection(targetHost, proxy) :
            await this.createSslDirectConnection(targetHost)
    }

    /**
     * Creates a connection to `targetHost` using specified `proxy`.
     */
    protected async createSslProxyConnection(targetHost: string, proxy: ProxyConfig): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const connectReq = this.createConnectReq(targetHost, proxy);
            connectReq.on('error', reject);
            connectReq.on('connect', (res: http.IncomingMessage, remoteSocket: net.Socket) => {
                if ((res.statusCode || 599) >= 400) {
                    const error = new ProxyConnectionFailed(`Proxy returned ${res.statusCode} ${res.statusMessage}`, {
                        proxy,
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
    protected async createSslDirectConnection(targetHost: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const url = new URL('https://' + targetHost);
            const port = Number(url.port) || 443;
            const remoteSocket = net.connect(port, url.hostname);
            remoteSocket.once('error', reject);
            remoteSocket.once('connect', () => resolve(remoteSocket));
        });
    }

    protected createConnectReq(targetHost: string, proxy: ProxyConfig): http.ClientRequest {
        const { useHttps = false } = proxy;
        const [hostname, port] = proxy.host.split(':');
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
        if (proxy.username || proxy.password) {
            connectReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(proxy));
        }
        return connectReq;
    }

}

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
import { makeBasicAuthHeader, ProxyUpstream, ProxyConnectionFailed } from './commons';
import { Logger } from './logger';
import { Connection, DEFAULT_PROXY_CONFIG, ProxyConfig } from './config';

const pipelineAsync = promisify(pipeline);

/**
 * Base class for implementing proxies.
 *
 * This class features an HTTP server accepting both HTTP and HTTPS incoming traffic,
 * and routing such traffic either to a target destination (i.e. the website),
 * or to the next proxy in chain (aka "upstream" proxy).
 */
export class BaseProxy {
    server: http.Server | null = null;
    clientSockets: Set<net.Socket> = new Set();
    trackedConnections: Map<string, Connection> = new Map();

    defaultUpstream: ProxyUpstream | null;
    logger: Logger;
    muteErrorCodes: string[];
    warnErrorCodes: string[];

    constructor(options: Partial<ProxyConfig> = {}) {
        const config = { ...DEFAULT_PROXY_CONFIG, ...options };
        this.defaultUpstream = config.defaultUpstream;
        this.logger = config.logger;
        this.muteErrorCodes = config.muteErrorCodes;
        this.warnErrorCodes = config.warnErrorCodes;
    }

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
     *
     * @param host - the host to connect to
     * @param request - the initial proxy http request; this will be either a CONNECT request for https,
     *   or a regular http request containing full URL in its first line (req.url).
     */
    matchRoute(host: string, request: http.IncomingMessage): ProxyUpstream | null {
        return this.defaultUpstream;
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
        options: http.ServerOptions = {
            insecureHTTPParser: true,
            maxHeaderSize: 65535
        },
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

    /**
     * Error handler hook can be overridden for custom error handling logic.
     *
     * By default it logs the error, unless it is muted according to `config.muteErrorCodes`.
     */
    onError(error: any, details: any = {}) {
        const isMuted = this.muteErrorCodes.includes(error.code);
        if (isMuted) {
            return;
        }
        const isWarn = this.warnErrorCodes.includes(error.code);
        error.details = {
            proxyClass: this.constructor.name,
            ...details,
            ...error.details,
        };
        const method = isWarn ? this.logger.warn : this.logger.error;
        method.call(this.logger, `Proxy error: ${error.message}`, { error });
    }

    // HTTPS

    async onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        try {
            // Note: CONNECT request's url always contains Host (hostname:port)
            const targetHost = req.url ?? '';
            const upstream = this.matchRoute(targetHost, req);
            const remoteConn = await this.createSslConnection(targetHost, upstream);
            await this.replyToConnectRequest(clientSocket, remoteConn);
            await Promise.all([
                pipelineAsync(remoteConn.socket, clientSocket),
                pipelineAsync(clientSocket, remoteConn.socket),
            ]);
        } catch (error) {
            this.onError(error, { handler: 'onConnect', url: req.url });
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

    protected async replyToConnectRequest(clientSocket: net.Socket, connection: Connection) {
        await new Promise((resolve, reject) => {
            const payload = [
                `HTTP/1.1 200 OK`,
                `X-Connection-Id: ${connection.connectionId}`,
                '',
                '',
            ].join('\r\n');
            clientSocket.write(payload, err => {
                if (err != null) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Creates an onward connection to `host` either directly or via upstream `proxy`.
     */
    async createSslConnection(host: string, upstream: ProxyUpstream | null): Promise<Connection> {
        const connection = upstream ?
            await this.sslProxyConnect(host, upstream) :
            await this.sslDirectConnect(host);
        const { connectionId, socket } = connection;
        this.trackedConnections.set(connectionId, connection);
        socket.on('close', () => this.trackedConnections.delete(connectionId));
        return connection;
    }

    /**
     * Creates a connection to `host` using specified `upstream`.
     */
    protected async sslProxyConnect(host: string, upstream: ProxyUpstream): Promise<Connection> {
        const connectReq = this.createConnectRequest(host, upstream);
        const [connectRes, socket] = await new Promise<[http.IncomingMessage, net.Socket]>((resolve, reject) => {
            connectReq.on('error', reject);
            connectReq.on('connect', (connectRes: http.IncomingMessage, remoteSocket: net.Socket) => resolve([connectRes, remoteSocket]));
            connectReq.end();
        });
        if (connectRes.statusCode! >= 400) {
            const error = new ProxyConnectionFailed(`Proxy returned ${connectRes.statusCode} ${connectRes.statusMessage}`, {
                upstream,
                statusCode: connectRes.statusCode
            });
            throw error;
        }
        const connectionId = String(connectRes.headers['x-connection-id']) || Math.random().toString(36).substring(2);
        const connection: Connection = { connectionId, host, upstream, socket };
        return connection;
    }

    /**
     * Creates a connection to `host` directly (without proxy).
     */
    protected async sslDirectConnect(host: string): Promise<Connection> {
        const connectionId = Math.random().toString(36).substring(2);
        const socket = await new Promise<net.Socket>((resolve, reject) => {
            const url = new URL('https://' + host);
            const port = Number(url.port) || 443;
            const socket = net.connect(port, url.hostname);
            socket.once('error', reject);
            socket.once('connect', () => resolve(socket));
        });
        return { connectionId, host, socket, upstream: null };
    }

    /**
     * Creates an onward CONNECT request to specified `targetHost` via specified `upstream` proxy.
     */
    protected createConnectRequest(targetHost: string, upstream: ProxyUpstream): http.ClientRequest {
        const { useHttps = false } = upstream;
        const [hostname, port] = upstream.host.split(':');
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
        if (upstream.username || upstream.password) {
            connectReq.setHeader('Proxy-Authorization', makeBasicAuthHeader(upstream));
        }
        return connectReq;
    }

    // HTTP

    async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            const { host } = new URL(req.url!);
            const upstream = this.matchRoute(host, req);
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
            this.onError(error, { handler: 'onRequest', url: req.url });
            res.writeHead(599);
            res.end();
        }
    }

    protected createProxyHttpRequest(req: http.IncomingMessage, proxy: ProxyUpstream): http.ClientRequest {
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

}

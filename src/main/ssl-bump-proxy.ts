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

import { BaseProxy } from './base-proxy';
import { SslCertStore } from './ssl-cert-store';
import http, { STATUS_CODES } from 'http';
import net from 'net';
import tls from 'tls';
import { ProxyConfig } from './commons';

/**
 * An SSL man-in-the-middle proxy which allows inspecting HTTPS traffic
 * and implement custom routing, request/response rewriting and forwarding logic.
 *
 * SSL MITM works using a technique originally known as
 * [SSL Bumping](https://wiki.squid-cache.org/Features/SslBump).
 *
 * Essentially, the server generates a new certificate for every incoming client connection,
 * presenting itself as a destination host (via subject alt names certificate fields) and
 * signing such certificates with a provided CA certificate.
 * Such a CA certificate will not recognized by clients and trigger security warnings
 * (and for good reasons, because the proxy is essentially eavesdropping an otherwise
 * secure connection). For that reason, SSL bumping is only possible with clients under your
 * control where the risks of decrypting traffic on-fly are properly understood.
 *
 * The *correct* way of allowing client to connect to a service with SSL bumping in chain
 * is to add the CA certificate as trusted on client's end. This differs per-client
 * (for example, Node.js has `ca` option when making https connections, for Chrome
 * the CLI flag `--ignore-certificate-errors-spki-list` can be used, with SPKI signature of
 * the CA certificate).
 *
 * The *incorrect* way to achieve this is to disable web security (i.e. teach a client
 * to not reject on SSL errors) — as well as adding custom CA certificate to globally trusted
 * OS-level store (this presents severe risks if the private key used to sign the certificates
 * is compromised).
 *
 * Once the TLS is negotiated between client and this proxy, the TLS is negotiated between
 * this proxy and remote client. This results in two TLS sockets
 * (duplex streams which do encryption/decryption on fly) — so the unencrypted requests can be
 * read from client and sent to server, and unencrypted responses can be read from server and
 * sent to client.
 */
export class SslBumpProxy extends BaseProxy {

    certStore: SslCertStore;
    remoteConnectionsMap = new Map<string, net.Socket>();

    constructor(public config: SslBumpConfig) {
        super();
        this.certStore = new SslCertStore(config);
    }

    /**
     * By default, all requests are routed directly. This can be overridden to provide more sophisticated routing.
     */
    matchRoute(_host: string) {
        return null;
    }

    getCACertificates() {
        return [this.config.caCert, ...super.getCACertificates()];
    }

    // TODO handle errors at various stages
    async onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        try {
            // req.url always contains hostname:port
            const targetHost = req.url ?? '';
            const [hostname, _port] = targetHost.split(':');
            const port = Number(_port) || 443;
            const tlsClientSocket = this.certStore.bumpClientSocket(hostname, clientSocket);
            const downstream = this.matchRoute(targetHost);
            const remoteSocket = await this.createSslConnection(targetHost, downstream);
            const tlsRemoteSocket = await this.negotiateTls(remoteSocket, hostname, port);
            // Track remote sockets, because we'll need them in http handler
            this.remoteConnectionsMap.set(targetHost, tlsRemoteSocket);
            remoteSocket.once('close', () => this.remoteConnectionsMap.delete(targetHost));
            clientSocket.write(`HTTP/${req.httpVersion} 200 OK\r\n\r\n`);
            // Route decrypted traffic through internal HTTP server
            const localHttpSocket = net.connect({
                port: this.getServerPort(),
                host: this.getServerAddress(),
            });
            tlsClientSocket.pipe(localHttpSocket);
            localHttpSocket.pipe(tlsClientSocket);
        } catch (error) {
            this.emit('error', error);
            const statusCode = (error as any).details?.statusCode ?? 502;
            const statusText = STATUS_CODES[statusCode];
            clientSocket.write(`HTTP/${req.httpVersion} ${statusCode} ${statusText}\r\n\r\n`);
            clientSocket.end();
        }
    }

    async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const host = req.headers.host ?? '';
        // console.log('I RECEIVED THE REQUEST!!!11', req.url, host);
        // TODO handle remoteSocket unavailable
        const remoteSocket = this.remoteConnectionsMap.get(host)!;
        // Forward:
        const lines: string[] = [];
        lines.push(`${req.method} ${req.url} HTTP/${req.httpVersion}`);
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        // console.log(lines.join('\r\n') + '\r\n');
        remoteSocket.write(lines.join('\r\n') + '\r\n\r\n');
        req.pipe(remoteSocket, { end: true });
        remoteSocket.pipe((res as any).socket, { end: true });

        // Dump the response right here:
        // for await (const chunk of remoteSocket) {
        //     console.log(chunk.toString());
        // }

        // Rewrite:
        // res.writeHead(200, {
        //     'content-type': 'text/plain',
        // });
        // res.end('PWNed bro');
    }

    protected async negotiateTls(remoteSocket: net.Socket, hostname: string, port: number) {
        const tlsRemoteSocket = tls.connect({
            socket: remoteSocket,
            host: hostname,
            port,
            servername: hostname,
            timeout: 60000,
            ca: this.getCACertificates(),
        }).setTimeout(60000, () => remoteSocket.end());
        await new Promise(r => tlsRemoteSocket.once('secureConnect', r));
        if (!tlsRemoteSocket.authorized) {
            tlsRemoteSocket.end();
            const error = new RemoteConnectionNotAuthorized(tlsRemoteSocket.authorizationError);
            this.emit('error', error)
        }
        return tlsRemoteSocket;
    }

}

export interface SslBumpConfig {
    /**
     * PEM-encoded CA certificate used to issue temporary certificates.
     */
    caCert: string;

    /**
     * PEM-encoded private key for signing temporary certificates.
     */
    caPrivateKey: string;

    /**
     * Public key to issue temporary certificates with.
     */
    certPublicKey: string;

    /**
     * Private key to issue temporary certificates with.
     */
    certPrivateKey: string;

    /**
     * Number of days for temporary certificates to expire (also used to cleanup cert cache).
     */
    certTtlDays: number;

    /**
     * Maximum number of cached certificates stored in cache simultaneously.
     */
    certCacheMaxEntries: number;
}

export class RemoteConnectionNotAuthorized extends Error {
    details: any;

    constructor(cause: Error) {
        super(`Remote connection not authorized: ${cause.message}`);
        this.details = { cause: { ... cause } };
    }
}

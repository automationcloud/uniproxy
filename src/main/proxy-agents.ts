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

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';

export class HttpsProxyAgent extends https.Agent {
    constructor(readonly hostname: string, readonly port: number, options: https.AgentOptions = {}) {
        super({
            keepAlive: true,
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
                const err = new ProxyConnectionFailed(`Proxy returned ${res.statusCode} ${res.statusMessage}`);
                return cb(err);
            }
            const tlsSocket = tls.connect({
                host: options.host,
                port: options.port,
                socket,
                ALPNProtocols: ['http/1.1'],
                ca: this.options.ca,
            });
            tlsSocket.on('error', err => cb(err));
            cb(null, tlsSocket);
        });
        connectReq.on('error', (err: any) => cb(err));
        connectReq.end();
    }
}

export class HttpProxyAgent extends http.Agent {
    constructor(readonly hostname: string, readonly port: number, options: http.AgentOptions = {}) {
        super({
            keepAlive: true,
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

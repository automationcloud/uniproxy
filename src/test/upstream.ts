import http from 'http';
import net from 'net';

import { BaseProxy } from '../main';
import { certificate } from './certs';
import { testLogger } from './logger';

/**
 * A tiny proxy which acts as an intermediate downstream proxy (i.e. connects directly to destination).
 */
export class UpstreamProxy extends BaseProxy {
    interceptedHttpRequest: http.IncomingMessage | null = null;
    interceptedConnectRequest: http.IncomingMessage | null = null;

    // For testing connection delays or interruptions
    errorOnConnect: Error | null = null;
    delayOnConnect: number = 0;
    connectAttempts: number = 0;

    constructor() {
        super();
        this.logger = testLogger;
        this.on('outboundConnect', _params => {
            this.connectAttempts += 1;
        });
    }

    override getCACertificates() {
        return [...super.getCACertificates(), certificate];
    }

    reset() {
        this.interceptedHttpRequest = null;
        this.interceptedConnectRequest = null;
        this.errorOnConnect = null;
        this.delayOnConnect = 0;
    }

    override async onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        this.interceptedConnectRequest = req;
        await super.onConnect(req, clientSocket);
    }

    override async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        this.interceptedHttpRequest = req;
        await super.onRequest(req, res);
    }

    // Note: we use authenticate for simulating connection issues, as it's invoked in both flows
    override async authenticate(_req: http.IncomingMessage) {
        await this.simulateConnectDelay();
        await this.simulateConnectError();
    }

    async simulateConnectDelay() {
        if (this.delayOnConnect) {
            await new Promise(r => setTimeout(r, this.delayOnConnect));
        }
    }

    async simulateConnectError() {
        if (this.errorOnConnect) {
            throw this.errorOnConnect;
        }
    }
}

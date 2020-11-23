import { BaseProxy } from '../../main';
import http from 'http';
import net from 'net';
import { certificate } from '../certs';

/**
 * A tiny proxy which acts as an upstream proxy (i.e. connects directly to destination).
 */
export class UpstreamProxy extends BaseProxy {
    interceptedHttpRequest: http.IncomingMessage | null = null;
    interceptedConnectRequest: http.IncomingMessage | null = null;

    getCACertificates() {
        return [...super.getCACertificates(), certificate];
    }

    reset() {
        this.interceptedHttpRequest = null;
        this.interceptedConnectRequest = null;
    }

    matchRoute(_host: string) {
        return null;
    }

    onConnect(req: http.IncomingMessage, clientSocket: net.Socket) {
        this.interceptedConnectRequest = req;
        super.onConnect(req, clientSocket);
    }

    onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        this.interceptedHttpRequest = req;
        super.onRequest(req, res);
    }
}

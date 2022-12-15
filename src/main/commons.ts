import http from 'http';
import net from 'net';

export interface ProxyUpstream {
    host: string;
    username?: string;
    password?: string;
    useHttps?: boolean;
}

export interface ProxyStats {
    bytesRead: number;
    bytesWritten: number;
}

/**
 * Describes an outbound connection established by proxy instance.
 * This can be either a direct connection to target host, or a connection to an upstream proxy.
 */
export interface Connection {
    connectionId: string;
    partitionId?: string;
    upstream: ProxyUpstream | null;
    socket: net.Socket;
    host: string;
}

export function makeBasicAuthHeader(config: ProxyUpstream) {
    const { username = '', password = '' } = config;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export function makeProxyUrl(config: ProxyUpstream) {
    const { useHttps, username = '', password = '' } = config;
    const protocol = useHttps ? 'https:' : 'http:';
    const auth = (username || password) ?
        `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
    return `${protocol}//${auth}${config.host}`;
}

export class ProxyConnectionFailed extends Error {
    override name = this.constructor.name;
    status: number;
    details: any;

    constructor(upstream: ProxyUpstream, status: number) {
        super(`Proxy connection failed: upstream returned ${status}`);
        this.status = status;
        this.details = { upstream: { ...upstream, password: '***' }, status };
    }
}

export class ProxyConnectionTimeout extends Error {
    override name = this.constructor.name;
    details: any;

    constructor(upstream: ProxyUpstream | null) {
        super(`Proxy connection timeout`);
        this.details = { upstream: { ...upstream, password: '***' } };
    }
}

export function makeRequestHead(req: http.IncomingMessage): string {
    const lines: string[] = [];
    lines.push(`${req.method} ${req.url} HTTP/${req.httpVersion}`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    return lines.join('\r\n') + '\r\n\r\n';
}

export function makeResponseHead(res: http.IncomingMessage): string {
    const lines: string[] = [];
    lines.push(`HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`);
    for (let i = 0; i < res.rawHeaders.length; i += 2) {
        lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
    }
    return lines.join('\r\n') + '\r\n\r\n';
}

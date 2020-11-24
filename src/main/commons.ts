import http from 'http';

export interface ProxyConfig {
    host: string;
    username?: string;
    password?: string;
    useHttps?: boolean;
}

export function makeBasicAuthHeader(config: ProxyConfig) {
    const { username = '', password = '' } = config;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export class ProxyConnectionFailed extends Error {
    details: any;

    constructor(cause: string, details: any) {
        super(`Connection to upstream proxy failed: ${cause}`);
        this.details = details;
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

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
        super(`Connection to proxy failed: ${cause}`);
        this.details = details;
    }
}

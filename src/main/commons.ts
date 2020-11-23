export interface ProxyUpstream {
    host: string;
    username?: string;
    password?: string;
    useHttps?: boolean;
}

export function makeBasicAuthHeader(upstream: ProxyUpstream) {
    const { username = '', password = '' } = upstream;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

import { HttpsProxyAgent, SslBumpProxy } from '../../main';
import { certificate, privateKey, publicKey } from '../certs';
import { HTTPS_PORT } from '../env';
import fetch from 'node-fetch';
import assert from 'assert';
import { UpstreamProxy } from '../upstream';

describe('SSL Bumping', () => {

    const upstreamProxy = new UpstreamProxy();

    beforeEach(() => upstreamProxy.start(0));
    beforeEach(() => upstreamProxy.reset());
    afterEach(() => upstreamProxy.shutdown(true));

    describe('passthrough', () => {

        const sslBumpProxy = new SslBumpProxy({
            // Note: we use same keys and certs for testing, but in reality those should be different!
            caCert: certificate,
            caPrivateKey: privateKey,
            certPrivateKey: privateKey,
            certPublicKey: publicKey,
            certCacheMaxEntries: 100,
            certTtlDays: 365,
        });
        beforeEach(() => sslBumpProxy.start(0));
        afterEach(() => sslBumpProxy.shutdown(true));

        async function sendRequestsWithAssertions() {
            const agent = new HttpsProxyAgent({
                host: `localhost:${sslBumpProxy.getServerPort()}`
            }, { ca: certificate });
            const res1 = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text1 = await res1.text();
            assert.strictEqual(text1, 'You requested GET /foo over https');
            const res2 = await fetch(`https://localhost:${HTTPS_PORT}/bar`, {
                agent,
                method: 'POST',
                body: 'Hello world!',
            });
            const text2 = await res2.text();
            assert.strictEqual(text2, 'You requested POST /bar over https\nHello world!');
        }

        context('direct connection', () => {
            beforeEach(() => sslBumpProxy.defaultUpstream = null);

            it('returns remote response', async () => {
                await sendRequestsWithAssertions();
                assert(upstreamProxy.interceptedConnectRequest == null);
            });
        });

        context('connection via upstream proxy', () => {
            beforeEach(() => sslBumpProxy.defaultUpstream = { host: `localhost:${upstreamProxy.getServerPort()}` });

            it('returns remote response through proxy', async () => {
                await sendRequestsWithAssertions();
                assert.strictEqual(upstreamProxy.interceptedConnectRequest?.url, `localhost:${HTTPS_PORT}`);
            });
        });

    });

});

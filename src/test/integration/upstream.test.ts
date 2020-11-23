import { HttpProxyAgent, HttpsProxyAgent } from '../../main';
import fetch from 'node-fetch';
import { HTTP_PORT, HTTPS_PORT } from '../env';
import assert from 'assert';
import { UpstreamProxy } from '../util/upstream';
import https from 'https';
import { certificate } from '../certs';

describe('Upstream Proxy', () => {

    const upstreamProxy = new UpstreamProxy();

    beforeEach(() => upstreamProxy.start(0));
    beforeEach(() => upstreamProxy.reset());
    afterEach(() => upstreamProxy.shutdown(true));

    describe('http', () => {

        it('sends direct requests without proxy', async () => {
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`);
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert(upstreamProxy.interceptedHttpRequest == null);
        });

        it('sends requests through upstream proxy', async () => {
            const agent = new HttpProxyAgent('localhost', upstreamProxy.getServerPort());
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(upstreamProxy.interceptedHttpRequest);
            assert.strictEqual(upstreamProxy.interceptedHttpRequest?.url,
                `http://localhost:${HTTP_PORT}/foo`);
        });

    });

    describe('https', () => {

        it('sends direct requests without proxy', async () => {
            const agent = new https.Agent({ ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert(upstreamProxy.interceptedHttpRequest == null);
        });

        it('sends requests through upstream proxy', async () => {
            const agent = new HttpsProxyAgent('localhost', upstreamProxy.getServerPort(), { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(upstreamProxy.interceptedConnectRequest);
            assert.strictEqual(upstreamProxy.interceptedConnectRequest?.url,
                `localhost:${HTTPS_PORT}`);
        });

    });

});

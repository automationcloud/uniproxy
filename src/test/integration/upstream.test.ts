import assert from 'assert';
import https from 'https';
import fetch from 'node-fetch';

import { HttpProxyAgent, HttpsProxyAgent } from '../../main';
import { certificate } from '../certs';
import { HTTP_PORT, HTTPS_PORT } from '../env';
import { UpstreamProxy } from '../upstream';

describe('Upstream Proxy', () => {

    const upstreamProxy = new UpstreamProxy();

    beforeEach(() => upstreamProxy.start(0));
    beforeEach(() => upstreamProxy.reset());
    afterEach(() => upstreamProxy.shutdown(true));

    describe('http', () => {

        it('sends direct requests without proxy', async () => {
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`);
            const text = await res.text();
            assert.strictEqual(text, 'You requested GET /foo over http');
            assert(upstreamProxy.interceptedHttpRequest == null);
        });

        it('sends GET through upstream proxy', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${upstreamProxy.getServerPort()}`,
            });
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested GET /foo over http');
            assert.ok(upstreamProxy.interceptedHttpRequest);
            assert.strictEqual(upstreamProxy.interceptedHttpRequest?.url,
                `http://localhost:${HTTP_PORT}/foo`);
        });

        it('sends POST through upstream proxy', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${upstreamProxy.getServerPort()}`,
            });
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, {
                agent,
                method: 'POST',
                body: 'Hello world!'
            });
            const text = await res.text();
            assert.strictEqual(text, 'You requested POST /foo over http\nHello world!');
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
            assert.strictEqual(text, 'You requested GET /foo over https');
            assert(upstreamProxy.interceptedHttpRequest == null);
        });

        it('sends GET through upstream proxy', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${upstreamProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested GET /foo over https');
            assert.ok(upstreamProxy.interceptedConnectRequest);
            assert.strictEqual(upstreamProxy.interceptedConnectRequest?.url,
                `localhost:${HTTPS_PORT}`);
        });

        it('sends POST through upstream proxy', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${upstreamProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, {
                agent,
                method: 'POST',
                body: 'Hello world!'
            });
            const text = await res.text();
            assert.strictEqual(text, 'You requested POST /foo over https\nHello world!');
            assert.ok(upstreamProxy.interceptedConnectRequest);
            assert.strictEqual(upstreamProxy.interceptedConnectRequest?.url,
                `localhost:${HTTPS_PORT}`);
        });

        it('calculates byte stats', async () => {
            assert.strictEqual(upstreamProxy.stats.bytesRead, 0);
            assert.strictEqual(upstreamProxy.stats.bytesWritten, 0);
            const agent = new HttpsProxyAgent({
                host: `localhost:${upstreamProxy.getServerPort()}`,
            }, { ca: certificate });
            await fetch(`https://localhost:${HTTPS_PORT}/foo`, {
                agent,
                method: 'POST',
                body: 'Hello world!'
            });
            assert(upstreamProxy.stats.bytesRead > 100);
            assert(upstreamProxy.stats.bytesWritten > 100);
            await upstreamProxy.shutdown();
            await upstreamProxy.start(0);
            assert.strictEqual(upstreamProxy.stats.bytesRead, 0);
            assert.strictEqual(upstreamProxy.stats.bytesWritten, 0);
        });

    });

});

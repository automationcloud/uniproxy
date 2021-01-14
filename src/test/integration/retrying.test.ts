import { HttpsProxyAgent } from '../../main';
import { HTTPS_PORT } from '../env';
import { UpstreamProxy } from '../upstream';
import fetch from 'node-fetch';
import assert from 'assert';
import { certificate } from '../certs';

describe('Retry on connect', () => {

    // Create two different upstream proxies for foo.local and bar.local —
    // and one router proxy in front of them

    let upstream: UpstreamProxy;
    beforeEach(async () => {
        upstream = new UpstreamProxy();
        await upstream.start(0);
    });
    afterEach(() => upstream.shutdown(true));

    let proxy: UpstreamProxy;
    beforeEach(async () => {
        proxy = new UpstreamProxy();
        proxy.defaultUpstream = {
            host: `localhost:${upstream.getServerPort()}`
        };
        await proxy.start(0);
    });
    afterEach(() => proxy.shutdown(true));

    context('on delay', () => {

        beforeEach(() => {
            upstream.delayOnConnect = 60000;
            proxy.connectRetryAttempts = 1;
            proxy.connectRetryInterval = 100;
        });

        it('retries upstream connection', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${proxy.getServerPort()}`,
            }, { ca: certificate });
            // Remove the delay after first few attempts
            setTimeout(() => upstream.delayOnConnect = 0, 50);
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested GET /foo over https');
            assert.ok(upstream.interceptedConnectRequest);
            assert.strictEqual(upstream.interceptedConnectRequest?.url, `localhost:${HTTPS_PORT}`);
            assert.strictEqual(proxy.connectAttempts, 2);
            assert.strictEqual(upstream.connectAttempts, 1);
        });

        it('fails if runs out of attempts', async () => {
            proxy.connectTimeout = 100;
            proxy.connectRetryAttempts = 1;
            const agent = new HttpsProxyAgent({
                host: `localhost:${proxy.getServerPort()}`,
            }, { ca: certificate });
            try {
                await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
                throw new Error('UnexpectedSuccess');
            } catch (err) {
                assert.strict(err.name, 'FetchError');
                assert.strictEqual(proxy.connectAttempts, 2);
                assert.strictEqual(upstream.connectAttempts, 0);
            }
        });

    });

    context('on error', () => {

        beforeEach(() => {
            upstream.errorOnConnect = new Error('Boom');
            proxy.connectRetryAttempts = 1;
            proxy.connectRetryInterval = 100;
        });

        it('retries upstream connection', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${proxy.getServerPort()}`,
            }, { ca: certificate });
            // Remove the delay after first few attempts
            setTimeout(() => upstream.errorOnConnect = null, 50);
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested GET /foo over https');
            assert.ok(upstream.interceptedConnectRequest);
            assert.strictEqual(upstream.interceptedConnectRequest?.url, `localhost:${HTTPS_PORT}`);
            assert.strictEqual(proxy.connectAttempts, 2);
            assert.strictEqual(upstream.connectAttempts, 1);
        });

        it('fails if runs out of attempts', async () => {
            proxy.connectRetryAttempts = 1;
            const agent = new HttpsProxyAgent({
                host: `localhost:${proxy.getServerPort()}`,
            }, { ca: certificate });
            try {
                await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
                throw new Error('UnexpectedSuccess');
            } catch (err) {
                assert.strict(err.name, 'FetchError');
                assert.strictEqual(proxy.connectAttempts, 2);
                assert.strictEqual(upstream.connectAttempts, 0);
            }
        });

    });

});

import { HttpProxyAgent, HttpsProxyAgent, RoutingProxy } from '../../main';
import { HTTPS_PORT, HTTP_PORT } from '../env';
import { DownstreamProxy } from '../util/downstream';
import fetch from 'node-fetch';
import assert from 'assert';
import { certificate } from '../certs';

describe('Routing Proxy', () => {

    // Create two different downstream proxies for foo.local and bar.local —
    // and one router proxy in front of them

    const fooProxy = new DownstreamProxy();
    beforeEach(() => fooProxy.start(0));
    beforeEach(() => fooProxy.reset());
    afterEach(() => fooProxy.shutdown(true));

    const barProxy = new DownstreamProxy();
    beforeEach(() => barProxy.start(0));
    beforeEach(() => barProxy.reset());
    afterEach(() => barProxy.shutdown(true));

    const routingProxy = new RoutingProxy();
    beforeEach(() => routingProxy.start(0));
    beforeEach(() => {
        routingProxy.clearRoutes();
        routingProxy.addRoute(/^foo.local:\d+$/, {
            host: `localhost:${fooProxy.getServerPort()}`,
            useHttps: false,
        });
        routingProxy.addRoute(/^bar.local:\d+$/, {
            host: `localhost:${barProxy.getServerPort()}`,
            useHttps: false,
        });
    });
    afterEach(() => routingProxy.shutdown(true));

    describe('http', () => {

        it('routes foo.local to foo downstream', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            });
            const res = await fetch(`http://foo.local:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(fooProxy.interceptedHttpRequest);
            assert.strictEqual(fooProxy.interceptedHttpRequest?.url,
                `http://foo.local:${HTTP_PORT}/foo`);
            assert(barProxy.interceptedHttpRequest == null);
        });

        it('routes bar.local to bar downstream', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            });
            const res = await fetch(`http://bar.local:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(barProxy.interceptedHttpRequest);
            assert.strictEqual(barProxy.interceptedHttpRequest?.url,
                `http://bar.local:${HTTP_PORT}/foo`);
            assert(fooProxy.interceptedHttpRequest == null);
        });

        it('routes unmatched requests directly', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            });
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert(fooProxy.interceptedHttpRequest == null);
            assert(barProxy.interceptedHttpRequest == null);
        });

    });

    describe('https', () => {

        it('routes foo.local to foo downstream', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://foo.local:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(fooProxy.interceptedConnectRequest);
            assert.strictEqual(fooProxy.interceptedConnectRequest?.url,
                `foo.local:${HTTPS_PORT}`);
            assert(barProxy.interceptedConnectRequest == null);
        });

        it('routes bar.local to bar downstream', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://bar.local:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(barProxy.interceptedConnectRequest);
            assert.strictEqual(barProxy.interceptedConnectRequest?.url,
                `bar.local:${HTTPS_PORT}`);
            assert(fooProxy.interceptedConnectRequest == null);
        });

        it('routes unmatched requests directly', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${routingProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert(fooProxy.interceptedConnectRequest == null);
            assert(barProxy.interceptedConnectRequest == null);
        });

    });

});

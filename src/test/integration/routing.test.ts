import { HttpProxyAgent, HttpsProxyAgent, RoutingProxy } from '../../main';
import { HTTPS_PORT, HTTP_PORT } from '../env';
import { UpstreamProxy } from '../util/upstream';
import fetch from 'node-fetch';
import assert from 'assert';
import { certificate } from '../certs';

describe('Routing Proxy', () => {

    // Create two different upstreams for foo.local and bar.local —
    // and one router proxy in front of them

    const fooUpstream = new UpstreamProxy();
    beforeEach(() => fooUpstream.start(0));
    beforeEach(() => fooUpstream.reset());
    afterEach(() => fooUpstream.shutdown(true));

    const barUpstream = new UpstreamProxy();
    beforeEach(() => barUpstream.start(0));
    beforeEach(() => barUpstream.reset());
    afterEach(() => barUpstream.shutdown(true));

    const routingProxy = new RoutingProxy();
    beforeEach(() => routingProxy.start(0));
    beforeEach(() => {
        routingProxy.clearRoutes();
        routingProxy.addRoute(/^foo.local:\d+$/, {
            host: `localhost:${fooUpstream.getServerPort()}`,
            useHttps: false,
        });
        routingProxy.addRoute(/^bar.local:\d+$/, {
            host: `localhost:${barUpstream.getServerPort()}`,
            useHttps: false,
        });
    });
    afterEach(() => routingProxy.shutdown(true));

    describe('http', () => {

        it('routes foo.local to foo upstream', async () => {
            const agent = new HttpProxyAgent('localhost', routingProxy.getServerPort());
            const res = await fetch(`http://foo.local:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(fooUpstream.interceptedHttpRequest);
            assert.strictEqual(fooUpstream.interceptedHttpRequest?.url,
                `http://foo.local:${HTTP_PORT}/foo`);
            assert(barUpstream.interceptedHttpRequest == null);
        });

        it('routes bar.local to bar upstream', async () => {
            const agent = new HttpProxyAgent('localhost', routingProxy.getServerPort());
            const res = await fetch(`http://bar.local:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(barUpstream.interceptedHttpRequest);
            assert.strictEqual(barUpstream.interceptedHttpRequest?.url,
                `http://bar.local:${HTTP_PORT}/foo`);
            assert(fooUpstream.interceptedHttpRequest == null);
        });

        it('routes unmatched requests directly', async () => {
            const agent = new HttpProxyAgent('localhost', routingProxy.getServerPort());
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert(fooUpstream.interceptedHttpRequest == null);
            assert(barUpstream.interceptedHttpRequest == null);
        });

    });

    describe('https', () => {

        it('routes foo.local to foo upstream', async () => {
            const agent = new HttpsProxyAgent('localhost', routingProxy.getServerPort(), { ca: certificate });
            const res = await fetch(`https://foo.local:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(fooUpstream.interceptedConnectRequest);
            assert.strictEqual(fooUpstream.interceptedConnectRequest?.url,
                `foo.local:${HTTPS_PORT}`);
            assert(barUpstream.interceptedConnectRequest == null);
        });

        it('routes bar.local to bar upstream', async () => {
            const agent = new HttpsProxyAgent('localhost', routingProxy.getServerPort(), { ca: certificate });
            const res = await fetch(`https://bar.local:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(barUpstream.interceptedConnectRequest);
            assert.strictEqual(barUpstream.interceptedConnectRequest?.url,
                `bar.local:${HTTPS_PORT}`);
            assert(fooUpstream.interceptedConnectRequest == null);
        });

        it('routes unmatched requests directly', async () => {
            const agent = new HttpsProxyAgent('localhost', routingProxy.getServerPort(), { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert(fooUpstream.interceptedConnectRequest == null);
            assert(barUpstream.interceptedConnectRequest == null);
        });

    });

});

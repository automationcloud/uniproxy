import { HttpProxyAgent, HttpsProxyAgent } from '../../main';
import fetch from 'node-fetch';
import { HTTP_PORT, HTTPS_PORT } from '../env';
import assert from 'assert';
import { DownstreamProxy } from '../util/downstream';
import https from 'https';
import { certificate } from '../certs';

describe('Downstream Proxy', () => {

    const downstreamProxy = new DownstreamProxy();

    beforeEach(() => downstreamProxy.start(0));
    beforeEach(() => downstreamProxy.reset());
    afterEach(() => downstreamProxy.shutdown(true));

    describe('http', () => {

        it('sends direct requests without proxy', async () => {
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`);
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert(downstreamProxy.interceptedHttpRequest == null);
        });

        it('sends requests through upstream proxy', async () => {
            const agent = new HttpProxyAgent({
                host: `localhost:${downstreamProxy.getServerPort()}`,
            });
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over http');
            assert.ok(downstreamProxy.interceptedHttpRequest);
            assert.strictEqual(downstreamProxy.interceptedHttpRequest?.url,
                `http://localhost:${HTTP_PORT}/foo`);
        });

    });

    describe('https', () => {

        it('sends direct requests without proxy', async () => {
            const agent = new https.Agent({ ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert(downstreamProxy.interceptedHttpRequest == null);
        });

        it('sends requests through upstream proxy', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${downstreamProxy.getServerPort()}`,
            }, { ca: certificate });
            const res = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo over https');
            assert.ok(downstreamProxy.interceptedConnectRequest);
            assert.strictEqual(downstreamProxy.interceptedConnectRequest?.url,
                `localhost:${HTTPS_PORT}`);
        });

    });

});

import { HttpProxyAgent } from '../main';
import fetch from 'node-fetch';
import { HTTP_PORT, UPSTREAM_PORT } from './env';
import assert from 'assert';
import { UpstreamProxy } from './util/upstream';

describe('Integration tests', () => {

    describe('http', () => {

        // We create a tiny proxy which serves as an upstream
        const upstreamProxy = new UpstreamProxy();

        beforeEach(() => upstreamProxy.start());
        beforeEach(() => upstreamProxy.reset());
        afterEach(() => upstreamProxy.shutdown(true));

        it('sends direct requests without proxy', async () => {
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`);
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo');
            assert(upstreamProxy.interceptedHttpRequest == null);
        });

        it('sends requests through upstream proxy', async () => {
            const agent = new HttpProxyAgent('localhost', UPSTREAM_PORT);
            const res = await fetch(`http://localhost:${HTTP_PORT}/foo`, { agent });
            const text = await res.text();
            assert.strictEqual(text, 'You requested /foo');
            assert.ok(upstreamProxy.interceptedHttpRequest);
            assert.strictEqual(upstreamProxy.interceptedHttpRequest?.url, 'http://localhost:3008/foo');
        });

    });

});

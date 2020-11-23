import { HttpsProxyAgent, SslBumpProxy } from '../../main';
import { certificate, privateKey, publicKey } from '../certs';
import { HTTPS_PORT } from '../env';
import fetch from 'node-fetch';
import assert from 'assert';

describe('SSL Bumping', () => {

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
    afterEach(() => sslBumpProxy.shutdown());

    describe('direct connections', () => {

        beforeEach(() => sslBumpProxy.upstreamProxy = null);

        it('works', async () => {
            const agent = new HttpsProxyAgent({
                host: `localhost:${sslBumpProxy.getServerPort()}`
            }, { ca: certificate });
            const res1 = await fetch(`https://localhost:${HTTPS_PORT}/foo`, { agent });
            const text1 = await res1.text();
            console.log(text1);
            const res2 = await fetch(`https://localhost:${HTTPS_PORT}/bar`, { agent });
            const text2 = await res2.text();
            console.log(text2);
        });

    });

});

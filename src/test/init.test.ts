import { HTTP_PORT, HTTPS_PORT } from './env';
import { patchDnsLookup } from './fake-dns';
import { httpServer, httpsServer, startServer } from './server';

before(() => {
    patchDnsLookup([
        ['foo.local', '127.0.0.1'],
        ['bar.local', '127.0.0.1'],
    ]);
});

before(async () => {
    await startServer(httpServer, HTTP_PORT);
    await startServer(httpsServer, HTTPS_PORT);
});

after(async () => {
    httpServer.close();
    httpsServer.close();
});

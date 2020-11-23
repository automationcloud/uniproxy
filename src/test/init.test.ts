import { HTTP_PORT, HTTPS_PORT } from './env';
import { httpServer, httpsServer, startServer } from './server';

before(async () => {
    await startServer(httpServer, HTTP_PORT);
    await startServer(httpsServer, HTTPS_PORT);
});

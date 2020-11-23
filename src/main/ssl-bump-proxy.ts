// Copyright 2020 UBIO Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { BaseProxy } from './base-proxy';
import { SslCertStore } from './ssl-cert-store';

/**
 * An SSL man-in-the-middle proxy which allows inspecting HTTPS traffic
 * and implement custom routing, request/response rewriting and forwarding logic.
 *
 * SSL MITM works using a technique originally known as
 * [SSL Bumping](https://wiki.squid-cache.org/Features/SslBump).
 *
 * Essentially, the server generates a new certificate for every incoming client connection,
 * presenting itself as a destination host (via subject alt names certificate fields) and
 * signing such certificates with a provided CA certificate.
 * Such a CA certificate will not recognized by clients and trigger security warnings
 * (and for good reasons, because the proxy is essentially eavesdropping an otherwise
 * secure connection). For that reason, SSL bumping is only possible with clients under your
 * control where the risks of decrypting traffic on-fly are properly understood.
 *
 * The *correct* way of allowing client to connect to a service with SSL bumping in chain
 * is to add the CA certificate as trusted on client's end. This differs per-client
 * (for example, Node.js has `ca` option when making https connections, for Chrome
 * the CLI flag `--ignore-certificate-errors-spki-list` can be used, with SPKI signature of
 * the CA certificate).
 *
 * The *incorrect* way to achieve this is to disable web security (i.e. teach a client
 * to not reject on SSL errors) — as well as adding custom CA certificate to globally trusted
 * OS-level store (this presents severe risks if the private key used to sign the certificates
 * is compromised).
 *
 * Once the TLS is negotiated between client and this proxy, the TLS is negotiated between
 * this proxy and remote client. This results in two TLS sockets
 * (duplex streams which do encryption/decryption on fly) — so the unencrypted requests can be
 * read from client and sent to server, and unencrypted responses can be read from server and
 * sent to client.
 */
export class SslBumpProxy extends BaseProxy {

    certStore: SslCertStore;

    constructor(public config: SslBumpConfig) {
        super();
        this.certStore = new SslCertStore(config);
    }

    matchRoute(host: string) {
        return null;
    }

}

export interface SslBumpConfig {
    /**
     * PEM-encoded CA certificate used to issue temporary certificates.
     */
    caCert: string;

    /**
     * PEM-encoded private key for signing temporary certificates.
     */
    caPrivateKey: string;

    /**
     * Public key to issue temporary certificates with.
     */
    certPublicKey: string;

    /**
     * Private key to issue temporary certificates with.
     */
    certPrivateKey: string;

    /**
     * Number of days for temporary certificates to expire (also used to cleanup cert cache).
     */
    certTtlDays: number;

    /**
     * Maximum number of cached certificates stored in cache simultaneously.
     */
    certCacheMaxEntries: number;
}

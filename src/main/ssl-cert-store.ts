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

import { SslBumpConfig } from './ssl-bump-proxy';
import tls from 'tls';
import net from 'net';
import { pki, md } from 'node-forge';
import crypto from 'crypto';
import LRUCache from 'lru-cache';
import { EventEmitter } from 'events';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A helper class for issuing temporary certificates and caching them as we go.
 */
export class SslCertStore extends EventEmitter {

    protected caCert: pki.Certificate;
    protected caCertPem: string;
    protected caPrivateKey: pki.rsa.PrivateKey;

    protected certPublicKey: pki.rsa.PublicKey;
    protected certPrivateKey: pki.rsa.PrivateKey;
    protected certPrivateKeyPem: string;

    protected certTtlDays: number;
    protected certPemCache: LRUCache<string, string>;

    constructor(config: SslBumpConfig) {
        super();
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                format: 'pem',
                type: 'spki',
            },
            privateKeyEncoding: {
                format: 'pem',
                type: 'pkcs8',
            }
        });
        this.caCert = pki.certificateFromPem(config.caCert);
        this.caCertPem = pki.certificateToPem(this.caCert);
        this.caPrivateKey = pki.privateKeyFromPem(config.caPrivateKey);
        this.certPublicKey = pki.publicKeyFromPem(publicKey);
        this.certPrivateKey = pki.privateKeyFromPem(privateKey);
        this.certPrivateKeyPem = pki.privateKeyToPem(this.certPrivateKey);
        this.certTtlDays = config.certTtlDays;
        this.certPemCache = new LRUCache({
            max: config.certCacheMaxEntries,
            maxAge: this.certTtlDays * DAY - HOUR,
        });
    }

    /**
     * Creates a (decrypted) TLS socket out of (encrypted) `clientSocket`.
     */
    bumpClientSocket(hostname: string, clientSocket: net.Socket): tls.TLSSocket {
        const secureContext = this.createSecureContextForHostname(hostname);
        const tlsClientSocket = new tls.TLSSocket(clientSocket, {
            isServer: true,
            secureContext,
            ALPNProtocols: ['http/1.1'],
        });
        return tlsClientSocket;
    }

    createSecureContextForHostname(hostname: string): tls.SecureContext {
        const cert = this.getCertificate(hostname);
        return tls.createSecureContext({
            key: this.certPrivateKeyPem,
            cert,
            ca: this.caCertPem,
        });
    }

    /**
     * Returns a temporary certificate for given hostname (either generates a new one, or
     * grabs one from cache).
     */
    getCertificate(hostname: string): string {
        const parentDomain = hostname.split('.').slice(1).join('.');
        const cached = this.certPemCache.get(hostname) || this.certPemCache.get(parentDomain);
        if (cached) {
            return cached;
        }
        const cert = this.createCertificate(hostname);
        this.certPemCache.set(hostname, cert);
        return cert;
    }

    /**
     * Creates a new temporary certificate for given hostname, ignoring the cache.
     */
    createCertificate(hostname: string): string {
        const cert = pki.createCertificate();
        cert.publicKey = this.certPublicKey;
        cert.serialNumber = '01' + parseInt(crypto.randomBytes(8).toString('hex'), 16);
        cert.validity.notBefore = new Date(Date.now() - DAY);
        cert.validity.notAfter = new Date(Date.now() + this.certTtlDays * DAY);
        cert.setSubject([
            { name: 'commonName', value: hostname },
            { name: 'organizationName', value: 'UBIO' }
        ]);
        cert.setIssuer(this.caCert.subject.attributes);
        cert.setExtensions([
            {
                name: 'basicConstraints',
                cA: true
            },
            {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            },
            {
                name: 'subjectAltName',
                altNames: [
                    { type: 2, value: hostname },
                    { type: 2, value: `*.${hostname}` },
                ]
            }
        ]);
        cert.sign(this.caPrivateKey, md.sha256.create());
        const pem = pki.certificateToPem(cert);
        this.emit('certificateIssued', { hostname, pem });
        return pem;
    }

}

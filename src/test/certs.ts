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

import { pki } from 'node-forge';
import crypto from 'crypto';

const hour = 60 * 60 * 1000;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: {
        format: 'pem',
        type: 'spki',
    },
    privateKeyEncoding: {
        format: 'pem',
        type: 'pkcs8',
    }
});

const cert = pki.createCertificate();
cert.publicKey = pki.publicKeyFromPem(publicKey);
cert.serialNumber = '01';
cert.validity.notBefore = new Date(Date.now() - hour);
cert.validity.notAfter = new Date(Date.now() + hour);
cert.setSubject([
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'Foo' }
]);
cert.setIssuer(cert.subject.attributes);
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
            { type: 2, value: `localhost` },
            { type: 2, value: `*.localhost` },
            { type: 2, value: `foo.local` },
            { type: 2, value: `bar.local` },
        ]
    }
]);
cert.sign(pki.privateKeyFromPem(privateKey));

export { privateKey, publicKey };
export const certificate = pki.certificateToPem(cert);

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

import { ProxyUpstream } from './commons';
import { Logger } from './logger';
import net from 'net';

/**
 * Proxy configuration object.
 */
export interface ProxyConfig {
    /**
     * Default upstream proxy is used when proxy doesn't provide any custom routing logic.
     *
     * For routing proxies, default upstream is used when the request does not match any
     * routing rules.
     */
    defaultUpstream: ProxyUpstream | null;

    /**
     * Logger interface for logging network errors.
     */
    logger: Logger;

    /**
     * A list of error codes from https://nodejs.org/api/errors.html#errors_node_js_error_codes
     * to be ignored and not logged at all.
     */
    muteErrorCodes: string[];

    /**
     * A list of error codes from https://nodejs.org/api/errors.html#errors_node_js_error_codes
     * to be treated as warnings istead of errors.
     */
    warnErrorCodes: string[];

    /**
     * Number of times to retry outbound connections until giving up.
     */
    connectRetryAttempts: number;

    /**
     * Interval between retrying to establish outbound connections.
     */
    connectRetryInterval: number;

    /**
     * Timeout for establishing outbound connections.
     */
    connectTimeout: number;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
    defaultUpstream: null,
    logger: console,
    muteErrorCodes: ['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ECONNRESET', 'EINVAL'],
    warnErrorCodes: ['ENOTCONN', 'ERR_STREAM_WRITE_AFTER_END', 'EPROTO'],
    connectRetryAttempts: 0,
    connectRetryInterval: 1000,
    connectTimeout: 10000,
};

/**
 * Describes an outbound connection established by proxy instance.
 * This can be either a direct connection to target host, or a connection to an upstream proxy.
 */
export interface Connection {
    connectionId: string;
    partitionId?: string;
    upstream: ProxyUpstream | null;
    socket: net.Socket;
    host: string;
}

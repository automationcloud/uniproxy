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
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
    defaultUpstream: null,
    logger: console,
    muteErrorCodes: ['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'],
    warnErrorCodes: ['ECONNRESET', 'EINVAL', 'ENOTCONN', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'],
};

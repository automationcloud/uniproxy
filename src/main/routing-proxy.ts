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
import { ProxyUpstream } from './commons';

/**
 * Proxy with dynamically configurable routing based on hostnames.
 *
 * The routing is performed by matching a destination hostname against the routing table
 * (populated by `addRoute` methods). First matching route wins.
 *
 * For convenience, routes can optionally be labelled and subsequently removed by the label.
 */
export class RoutingProxy extends BaseProxy {
    protected routes: ProxyRoute[] = [];

    matchRoute(host: string): ProxyUpstream | null {
        for (const route of this.routes) {
            if (route.hostRegexp.test(host)) {
                return route.upstream;
            }
        }
        return this.defaultUpstream;
    }

    /**
     * Clears routing table. All requests will be routed directly.
     */
    clearRoutes() {
        this.routes = [];
    }

    /**
     * Inserts new route. Requests matching specified `hostRegexp` will be routed
     * to specified `proxy`.
     * New route is inserted at the beginning of the list, and routes are matched in order
     * they added (first match wins).
     */
    addRoute(hostRegexp: RegExp, proxy: ProxyUpstream | null, label: string = 'default') {
        this.routes.unshift({ label, hostRegexp, upstream: proxy });
    }

    /**
     * Removes routes matching specified label.
     */
    removeRoutes(label: string) {
        this.routes = this.routes.filter(r => r.label !== label);
    }

    // Serialization (because RegExps are not otherwise serializable)

    getSerializedRoutes(): SerializedProxyRoute[] {
        return this.routes.map(_ => {
            return {
                label: _.label,
                hostRegexp: {
                    source: _.hostRegexp.source,
                    flags: _.hostRegexp.flags,
                },
                upstream: _.upstream,
            };
        });
    }

    setSerializedRoutes(serializedRoutes: SerializedProxyRoute[]) {
        this.routes = serializedRoutes.map(sr => {
            return {
                label: sr.label,
                hostRegexp: new RegExp(sr.hostRegexp.source, sr.hostRegexp.flags),
                upstream: sr.upstream,
            };
        });
    }
}

export interface ProxyRoute {
    label: string;
    hostRegexp: RegExp;
    upstream: ProxyUpstream | null;
}

export interface SerializedProxyRoute {
    label: string;
    hostRegexp: {
        source: string;
        flags: string;
    };
    upstream: ProxyUpstream | null;
}

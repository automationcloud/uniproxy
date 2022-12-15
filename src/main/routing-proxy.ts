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

    getRoutes() {
        return this.routes;
    }

    override matchRoute(host: string): ProxyUpstream | null {
        for (const route of this.routes) {
            if (new RegExp(route.hostPattern, 'gi').test(host)) {
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
    insertRoute(route: ProxyInsertRouteSpec, index: number = 0) {
        this.routes.splice(index, 0, {
            label: 'default',
            ...route,
        });
    }

    /**
     * Removes routes matching specified label.
     */
    removeRoutes(label: string) {
        this.routes = this.routes.filter(r => r.label !== label);
    }

}

export interface ProxyRoute {
    label: string;
    hostPattern: string;
    upstream: ProxyUpstream | null;
}

export interface ProxyInsertRouteSpec {
    label?: string;
    hostPattern: string;
    upstream: ProxyUpstream | null;
}

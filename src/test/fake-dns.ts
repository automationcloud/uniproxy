import dns from 'dns';

const originalLookup = dns.lookup;

export function patchDnsLookup(hardcodedEntries: Array<[string, string]>) {
    const lookup = function(domain: any, options: any, callback: any) {
        const entry = hardcodedEntries.find(_ => _[0] === domain);
        if (entry) {
            return callback(null, entry[1], 4);
        }
        return originalLookup(domain, options, callback);
    };
    (dns as any).lookup = lookup;
}

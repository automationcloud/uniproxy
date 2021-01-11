import { Logger } from '../main';

export const testLogger: Logger = process.env.DEBUG ? console : {
    info() {},
    warn() {},
    error() {},
    debug() {},
}

/**
 * Utility class for creating error subclasses with more specific name and details.
 *
 * Use this class when you need to include more debugging details in logs,
 * but still prefer to not expose them via HTTP response.
 *
 * If you need to communicate additional details to clients, use `ClientError` instead.
 */
export class Exception extends Error {
    name = this.constructor.name;
    status: number = 500;
    details: any = {};
}

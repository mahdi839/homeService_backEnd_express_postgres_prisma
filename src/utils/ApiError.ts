export class ApiError extends Error {
    statusCode: number;
    errorDetails: unknown;

    constructor(statusCode: number, message: string, errorDetails: unknown = null) {
        super(message);
        this.statusCode = statusCode;
        this.errorDetails = errorDetails;
    }
}
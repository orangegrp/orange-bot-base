import type { ApiError as _ApiError } from "./apiTypes.js";
import { ApiErrorType } from "./apiTypes.js";


const apiStatusCodes: { [KEY in keyof typeof ApiErrorType]: number } = {
    fastify_error: 0,
    not_found: 404,
    unknown_error: 500,
    no_permission: 403,
    invalid_snowflake: 400,
    member_not_found: 400,
    guild_not_found: 400,
    module_not_found: 400,
    invalid_edits: 400
} as const;

const apiErrorNames: { [KEY in keyof typeof ApiErrorType]: string } = {
    fastify_error: "",
    not_found: "Not Found",
    unknown_error: "Unknown Error",
    no_permission: "No Permission",
    invalid_snowflake: "Invalid Snowflake",
    member_not_found: "Member Not Found",
    guild_not_found: "Guild Not Found",
    module_not_found: "Module Not Found",
    invalid_edits: "Invalid Edits"
} as const;


class ApiError implements _ApiError {
    readonly statusCode: number;
    readonly error: string;
    readonly raw?: string;
    constructor(readonly type: ApiErrorType, readonly message: string, original?: Error) {
        this.statusCode = apiStatusCodes[this.type];
        this.error = apiErrorNames[this.type];
        original && (this.raw = original.message);
    }
    static unknown(message: string, original?: Error) {
        return new ApiError(ApiErrorType.unknown_error, message, original);
    }
    static noPermission(message: string) {
        return new ApiError(ApiErrorType.no_permission, message);
    }
}


export { ApiError }
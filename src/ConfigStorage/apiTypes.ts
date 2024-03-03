import { ConfigValueType, ConfigValueAny, RealValueType, ConfigValueTyped, RealValueTypeOf } from "./types.js";



type ApiDiscordItem = {
    name: string,
    id: string,
    icon: string | null
}



type ApiConfigValue<Type extends ConfigValueType> = ConfigValueTyped<Type> & { 
    name: string,
} & (Type extends (ConfigValueType.user | ConfigValueType.channel | ConfigValueType.member) ? {
    value: ApiDiscordItem | null;
} : {
    value: RealValueTypeOf<ConfigValueTyped<Type>> | null
})

type ApiModule = {
    module: string,
    displayName: string,
    values: ApiConfigValue<ConfigValueType>[]
}

type SettingsList = ApiModule[]

type ValueEdits = {
    [name: string]: RealValueType<ConfigValueType>
}

enum ValueValidationResult {
    valid = "valid",
    invalid_module = "invalid_module",
    invalid_name = "invalid_name",
    invalid_type = "invalid_type",
    invalid_value = "invalid_value",
    no_permission = "no_permission",
}
type ValueValidationResults = {
    [key: string]: ValueValidationResult;
}
type ValueEditResult = {
    success: boolean,
    results: ValueValidationResults
}


type ApiGuild = {
    id: string,
    name: string,
    nameAcronym: string,
    iconUrl: string | null
}


enum ApiErrorType {
    fastify_error = "fastify_error",
    not_found = "not_found",
    unknown_error = "unknown_error",
    no_permission = "no_permission",
    invalid_snowflake = "invalid_snowflake",
    member_not_found = "member_not_found",
    guild_not_found = "guild_not_found",
    module_not_found = "module_not_found",
    invalid_edits = "invalid_edits",
}

type ApiError = {
    /** HTTP status code */
    readonly statusCode: number;
    /** Readable name for the error */
    readonly error: string;
    /** Readable message */
    readonly message: string;
    /** raw error (if any) */
    readonly raw?: string;
    /** Type of error */
    readonly type: ApiErrorType;
}

export type { SettingsList, ApiConfigValue, ValueEdits, ValueEditResult, ApiGuild, ApiError, ApiDiscordItem }
export { ApiErrorType, ValueValidationResults, ValueValidationResult }
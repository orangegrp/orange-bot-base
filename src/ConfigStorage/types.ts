import type { Snowflake, PermissionResolvable } from "discord.js";

enum ConfigValueType {
    string,
    number,
    integer,
    user,
    channel,
    member,
    object
}

type ConfigConfig = {
    /**
     * name of the module, must be unique, will be used on pocketbase as x_dyn_name_gcfg and x_dyn_name_ucfg
     * spaces are not allowed
     */
    readonly name: string
    /**
     * readable name of the module
     */
    readonly displayName: string;

    readonly user?: ConfigValues<"user">,
    readonly guild?: ConfigValues<"guild">,
    readonly global?: ConfigValues<"global">
}

type ConfigValueScope = "user" | "guild" | "global";

type ConfigValues<Scope extends ConfigValueScope> = {
    [name: string]: ConfigValueAnyScoped<Scope>
}


type ConfigValueBase<Type extends ConfigValueType, Scope extends ConfigValueScope> = {
    /**
     * Name of the value, displayed in settings UI
     */
    displayName: string,
    /**
     * Description of the value, displayed in settings UI
     */
    description: string,
    /**
     * If value should be visible in UI
     */
    uiVisibility?: "visible" | "readonly" | "hidden",
    type: Type,
} & ({
    /**
     * Should this be an array of values?
     */
    array: true,
    /**
     * Default value
     */
    default?: RealValueType<Type>[]
    /**
     * Max number of values in the array
     */
    maxCount?: number
} | {
    array?: false | undefined,
    /**
     * Default value
     */
    default?: RealValueType<Type>
}) & (Scope extends "guild" ? {
    /**
     * Required permissions for setting this value, only when Scope: "guild"
     */
    permissions?: PermissionResolvable
} : {})


type ConfigValueString<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.string, Scope> & {
    /** Max length of the string */
    maxLength?: number,
    /** Min lenght of the string */
    minLength?: number,
    /** Choices for the string value (restrict to only these) */
    choices?: string[]
}

type ConfigValueNumber<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.number, Scope> & {
    /** Max value of the number */
    maxValue?: number,
    /** Min value of the number */
    minValue?: number,
    /** Choices for the number value (restrict to only these) */
    choices?: number[]
}

type ConfigValueInteger<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.integer, Scope> & {
    /** Max value of the integer */
    maxValue?: number,
    /** Min value of the integer */
    minValue?: number,
    /** Choices for the integer value (restrict to only these) */
    choices?: number[],
}

type ConfigValueUser<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.user, Scope>;
type ConfigValueChannel<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.channel, Scope>;
type ConfigValueMember<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.member, Scope>;

type ConfigValueObject<Scope extends ConfigValueScope> = ConfigValueBase<ConfigValueType.object, Scope> & {
    schema: any,
}

type ConfigValueAnyScoped<Scope extends ConfigValueScope> = 
    ConfigValueString<Scope> 
    | ConfigValueNumber<Scope>
    | ConfigValueInteger<Scope>
    | ConfigValueUser<Scope>
    | ConfigValueChannel<Scope>
    | ConfigValueMember<Scope>
    | ConfigValueObject<Scope>;

type ConfigValueTypedScoped<Type extends ConfigValueType, Scope extends ConfigValueScope> = 
    Type extends ConfigValueType.string  ? ConfigValueString<Scope>  :
    Type extends ConfigValueType.number  ? ConfigValueNumber<Scope>  :
    Type extends ConfigValueType.integer ? ConfigValueInteger<Scope> :
    Type extends ConfigValueType.user    ? ConfigValueUser<Scope>    :
    Type extends ConfigValueType.channel ? ConfigValueChannel<Scope> :
    Type extends ConfigValueType.member  ? ConfigValueMember<Scope>  :
    Type extends ConfigValueType.object  ? ConfigValueObject<Scope>  :
    never;

type ConfigValueTyped<Type extends ConfigValueType> = ConfigValueTypedScoped<Type, ConfigValueScope>;


type ConfigValueAny = ConfigValueAnyScoped<ConfigValueScope>;

type RealValueType<T extends ConfigValueType> = 
      T extends ConfigValueType.string   ? string
    : T extends ConfigValueType.number   ? number
    : T extends ConfigValueType.integer  ? number
    : T extends ConfigValueType.user     ? Snowflake
    : T extends ConfigValueType.channel  ? Snowflake
    : T extends ConfigValueType.member   ? Snowflake
    : T extends ConfigValueType.object   ? object
    : never;

type ArrayOfOrType<T, IsArray extends boolean> = IsArray extends true ? T[] : T;

type RealValueTypeOf<T extends ConfigValueBase<ConfigValueType, ConfigValueScope>> = ArrayOfOrType<RealValueType<T["type"]>, T extends { array: true } ? true : false>;

type ReturnValueTypeOf<T extends ConfigValueBase<ConfigValueType, ConfigValueScope>> = T["default"] extends undefined ? RealValueTypeOf<T> | undefined : RealValueTypeOf<T>;

type ConfigValuesObj<Values extends ConfigValues<ConfigValueScope>> = { [KEY in keyof Values]: ReturnValueTypeOf<Values[KEY]> }


export type { ConfigConfig, ConfigValues, ConfigValueAny, ConfigValueAnyScoped, RealValueType, RealValueTypeOf, ReturnValueTypeOf, ConfigValuesObj, ConfigValueTyped }
export { ConfigValueScope, ConfigValueType }
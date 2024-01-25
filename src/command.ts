import { ApplicationCommandOptionType, type CommandInteractionOption } from "discord.js";
import type { User, GuildMember, Attachment, Role, Channel, Snowflake, APIInteractionDataResolvedGuildMember, APIInteractionDataResolvedChannel, APIRole } from "discord.js"

enum ArgType {
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11
}


enum CommandType {
    /** Slash command */
    CHAT_INPUT = 1,
    /** User interaction menu button */
    USER = 2,
    /** Message interaction menu button */
    MESSAGE = 3
}

type CommandArgChoice = {
    /** Name of the choice option */
    name: string,
    /** Value for the choice option (string, integer, or double) */
    value: string
}

type CommandArg = {
    /** 1-100 character description */
    description: string;
    /**If the parameter is required or optional--default false */
    required?: boolean;
} & ({
    /** Type of option */
    type: Exclude<ArgType, ArgType.STRING | ArgType.INTEGER | ArgType.NUMBER>;
} | {
    /** Choices for `STRING`, `INTEGER`, and `NUMBER` types for the user to pick from, max `25` */
    choices?: CommandArgChoice[];
    /** If the option is an `INTEGER` or `NUMBER` type, the minimum value permitted */
    min_value?: number;
    /** If the option is an `INTEGER` or `NUMBER` type, the maximum value permitted */
    max_value?: number;
    /**If autocomplete interactions are enabled for this `STRING`, `INTEGER`, or `NUMBER` type option */
    autocomplete?: boolean;
    type: ArgType.INTEGER | ArgType.NUMBER;
} | {
    /** Choices for `STRING`, `INTEGER`, and `NUMBER` types for the user to pick from, max `25` */
    choices?: CommandArgChoice[];
    /**	For option type `STRING`, the minimum allowed length (minimum of `0`, maximum of `6000`) */
    min_length?: number;
    /** For option type `STRING`, the maximum allowed length (minimum of `1`, maximum of `6000`) */
    max_lenght?: number;
    /**If autocomplete interactions are enabled for this `STRING`, `INTEGER`, or `NUMBER` type option */
    autocomplete?: boolean;
    type: ArgType.STRING;
})
type SubCommandGroup = {
    description: string;
    required?: boolean;
    options: { [name: string]: SubCommand };
}
type SubCommand = {
    description: string;
    required?: boolean;
    args: CommandArgs;
}
type CommandArgs = {
    [name: string]: CommandArg
}
type CommandOptions = {
    [name: string]: SubCommandGroup | SubCommand
}

type Command = {
    /**
     * Type of the command
     * 
     * defaults `CommandType.CHAT_INPUT` if not defined
     */
    type?: CommandType,
    /**
     * Name of the command
     */
    name: string,
    /**
     * Command description
     */
    description: string,
    /**
     * Set to true to bypass automatically wrapping the command executor in a try-catch
     */
    dontWrap?: boolean
} & (
    {
        /**
         * key-value pairs of subcommands or subcommand groups
         */
        options: CommandOptions,
        args?: undefined,
    } | {
        /**
         * key-value pairs of command arguments
         */
        args: CommandArgs,
        options?: undefined,
    }
)


type UserArg = {
    user?: User,
    member?: GuildMember | APIInteractionDataResolvedGuildMember  | null,
    id: Snowflake
}
type ChannelArg = {
    channel?: Channel | APIInteractionDataResolvedChannel | null,
    id: Snowflake
}
type RoleArg = {
    role?: Role | APIRole | null,
    id: Snowflake
}
type AttachmentArg = {
    attachment?: Attachment,
    id: Snowflake
}
type MentionableArg = UserArg | ChannelArg;


type ResolveType<T> =
    T extends ArgType.STRING      ? string 
  : T extends ArgType.INTEGER     ? number
  : T extends ArgType.BOOLEAN     ? boolean
  : T extends ArgType.USER        ? UserArg
  : T extends ArgType.CHANNEL     ? ChannelArg
  : T extends ArgType.ROLE        ? RoleArg
  : T extends ArgType.MENTIONABLE ? MentionableArg
  : T extends ArgType.NUMBER      ? number
  : T extends ArgType.ATTACHMENT  ? AttachmentArg
  : any;

type ResolveRequired<T extends any, R extends boolean | undefined> = R extends true ? T : T | undefined;
type ResolveArgs<T extends CommandArgs> = { [KEY in keyof T]: ResolveRequired<ResolveType<T[KEY]["type"]>, T[KEY]["required"]> }
//type ResolveSubCommandGroup<T extends SubCommandGroup> = (ResolveSubCommand<T["options"][keyof T["options"]]>);
type ResolveSubCommand<T extends SubCommand | SubCommandGroup, NAME extends string> = 
    T extends SubCommandGroup ? (ResolveSubCommands<T["options"]>) & { "subCommandGroup": NAME }
  : T extends SubCommand ? (ResolveArgs<T["args"]>) & { "subCommand": NAME }
  : never;;

type ResolveSubCommands<T extends { [name: string]: SubCommand | SubCommandGroup }> = { [KEY in keyof T]: ResolveSubCommand<T[KEY], KEY & string> }[keyof T]
/**@ts-ignore */
type ResolveCommandArgs<T extends Command> = 
    T extends { args: CommandArgs } ? ResolveArgs<T["args"]> 
  : T extends { options: CommandOptions } ? ResolveSubCommands<T["options"]> 
  : never;

type CommandArgsBase = {
    [key: string]: ResolveType<ArgType> | undefined
} & {
    subCommandGroup?: string;
    subCommand?: string;
}

function parseInteractionOptions(data: readonly CommandInteractionOption[]): CommandArgsBase {
    const args: CommandArgsBase = {};
    for (const option of data) {
        if (option.type == ApplicationCommandOptionType.SubcommandGroup) {
            parseInteractionSubcommandGroup(option, args);
        }
        else if (option.type == ApplicationCommandOptionType.Subcommand && option.options) {
            parseInteractionSubcommand(option, args)
        }
        else {
            parseInteractionArg(option, args);
        }
    }
    return args;
}
function parseInteractionSubcommandGroup(data: CommandInteractionOption, args: CommandArgsBase) {
    if (!data.options) return;
    args.subCommandGroup = data.name;
    for (const option of data.options) {
        if (option.type == ApplicationCommandOptionType.Subcommand && option.options) {
            parseInteractionSubcommand(option, args)
        }
        else {
            parseInteractionArg(option, args);
        }
    }
}
function parseInteractionSubcommand(data: CommandInteractionOption, args: CommandArgsBase) {
    if (!data.options) return;
    args.subCommand = data.name;
    for (const option of data.options) {
        parseInteractionArg(option, args);
    }
}
function parseInteractionArg(data: CommandInteractionOption, args: CommandArgsBase) {
    switch (data.type) {
        case ApplicationCommandOptionType.User:
            if (typeof(data.value) != "string") throw new TypeError("Data of type user is not a user id");
            args[data.name] = { user: data.user, member: data.member, id: data.value  } satisfies UserArg
            break;
        case ApplicationCommandOptionType.Channel:
            if (typeof(data.value) != "string") throw new TypeError("Data of type user is not a channel id");
            args[data.name] = { channel: data.channel, id: data.value  } satisfies ChannelArg
            break;
        case ApplicationCommandOptionType.Role:
            if (typeof(data.value) != "string") throw new TypeError("Data of type role is not a role id");
            args[data.name] = { role: data.role, id: data.value  } satisfies RoleArg
            break;
        case ApplicationCommandOptionType.Mentionable:
            if (typeof(data.value) != "string") throw new TypeError("Data of type mentionable is not a mentionable id");
            args[data.name] = { channel: data.channel, user: data.user, member: data.member, id: data.value } satisfies MentionableArg
            break;
        case ApplicationCommandOptionType.Attachment:
            if (typeof(data.value) != "string") throw new TypeError("Data of type attachment is not an attachment id");
            args[data.name] = { attachment: data.attachment, id: data.value } satisfies AttachmentArg;
            break;
        default:
            args[data.name] = data.value;
            break;

    }
}

export type { Command, CommandArgs, CommandOptions }
export { CommandType, ArgType, ResolveCommandArgs, CommandArgsBase, parseInteractionOptions }

import { REST, Routes, ApplicationCommandOptionType } from "discord.js";
import type { Permissions, LocaleString, Snowflake, ApplicationCommandOption, ApplicationCommandSubCommand, ApplicationCommandSubGroup } from "discord.js"
import { ArgType, CommandArgs, CommandOptions, CommandType } from "./command.js";
import { getLogger } from "orange-common-lib";
import type { Bot } from "./bot";
import util from "util";
import chalk from "chalk";

const logger = getLogger("commandDeployer");


type DiscordCommand = {
    type?: CommandType,
    name: string,
    name_localizations?: { [key in LocaleString]: string },
    description: string,
    description_localizations?: { [key in LocaleString]: string },
    options?: ApplicationCommandOption[],
    default_member_permissions?: Permissions,
    dm_permission?: boolean,
    nsfw?: boolean,
}
type DiscordCommandFull = DiscordCommand & {
    id: Snowflake,
    application_id: Snowflake,
    guild_id?: Snowflake,
    version: Snowflake
}

class CommandDeployer {
    private readonly bot: Bot;
    private readonly rest: REST;
    private readonly userId: string;
    constructor(bot: Bot, token: string) {
        this.bot = bot;
        if (!bot.client.user) {
            throw new Error("");
        }
        this.userId = bot.client.user.id;
        this.rest = new REST().setToken(token);
    }
    /**
     * Deploys (or redeploys) commands
     * @param guildId id if the guild (if omitted, commands will be deployed globally)
     */
    async deploy(guildId?: Snowflake) {
        logger.info("Validating commands...");

        const toDeploy = await this.validate(guildId);

        if (toDeploy.length == 0) {
            logger.info("All commands are up to date. Nothing to deploy.");
            return;
        }

        logger.info("Deploying commands...");

        for (const name of toDeploy) {
            logger.info(`Deploying ${name}...`);

            (await this.deployCommand(name, guildId))
                ? logger.ok(`Successfully deployed ${name}!`)
                : logger.error(`Failed to deploy ${name}.`);
        }
    }
    private async deployCommand(name: string, guildId?: Snowflake): Promise<boolean> {
        const command = this.bot.commandManager.commands.get(name);
        if (!command) {
            logger.error(`Error deploying command ${name}. Command not found.`);
            return false;
        }

        const dcCmd: DiscordCommand = {
            type: command.type,
            name: command.name,
            description: command.description,
            options: command.args 
                ? this.mapCommandArgs(command.args)
                : this.mapCommandOptions(command.options),
        }

        const outCmd = await this.rest.post(
            guildId ? Routes.applicationGuildCommands(this.userId, guildId) 
                    : Routes.applicationCommands(this.userId), { body: dcCmd  }) as DiscordCommandFull;
        
        command.id = outCmd.id;
        return true;
    }
    private mapCommandOptions(opts: CommandOptions): (ApplicationCommandSubCommand | ApplicationCommandSubGroup)[] {
        const optsDc: (ApplicationCommandSubCommand | ApplicationCommandSubGroup)[] = [];

        for (const name in opts) {
            const opt = opts[name];
            if ("args" in opt) {
                optsDc.push({
                    type: ApplicationCommandOptionType.Subcommand,
                    description: opt.description,
                    name: name,
                    options: this.mapCommandArgs(opt.args)
                })
            }
            if ("options" in opt) {
                optsDc.push({
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    description: opt.description,
                    name: name,
                    options: this.mapCommandOptions(opt.options) as any
                })
            }
        }

        return optsDc;
    }

    private mapCommandArgs(args: CommandArgs): Exclude<ApplicationCommandOption, ApplicationCommandSubGroup | ApplicationCommandSubCommand>[] {
        const argsDc: Exclude<ApplicationCommandOption, ApplicationCommandSubGroup | ApplicationCommandSubCommand>[] = [];
        // show volk
        for (const name in args) {
            const arg = args[name];

            // this code is cursed
            argsDc.push((arg.type == ArgType.STRING) ? (
                    !!arg.autocomplete ? {
                        description: arg.description,
                        required: arg.required,
                        type: arg.type as number,
                        name: name,
                        autocomplete: true,
                        minLength: arg.min_length,
                        maxLength: arg.max_lenght
                    } : {
                        description: arg.description,
                        required: arg.required,
                        type: arg.type as number,
                        name: name,
                        choices: arg.choices
                    }
                )
                : (arg.type == ArgType.INTEGER || arg.type == ArgType.NUMBER) ? (
                    !!arg.autocomplete ? {
                        description: arg.description,
                        required: arg.required,
                        type: arg.type as number,
                        name: name,
                        autocomplete: true,
                        minValue: arg.min_value,
                        maxLength: arg.max_value
                    } : {
                        description: arg.description,
                        required: arg.required,
                        type: arg.type as number,
                        name: name,
                        choices: arg.choices
                    }
                )
                : {
                    description: arg.description,
                    required: arg.required,
                    type: arg.type as number,
                    name: name,
                });
        }

        return argsDc;
    }
    /**
     * Validates that commands are identical locally and on discords side
     * @param guildId id of the guild (if omitted, use global)
     * @returns array of function names that are invalid
     */
    async validate(guildId?: Snowflake): Promise<string[]> {
        const data = await this.rest.get(
            guildId ? Routes.applicationGuildCommands(this.userId, guildId) 
                    : Routes.applicationCommands(this.userId)) as DiscordCommandFull[];
        
        //logger.log(`Found ${data.length} commands on discord side`);

        const commands = Object.fromEntries(data.map(cmd => [cmd.name, cmd]));

        //logger.log(`Found ${Object.keys(commands).length} commands on local side`);

       
        const toDeploy: string[] = [];

        // loop thru all commands in commandManager
        for (const [name, command] of this.bot.commandManager.commands) {
            if (!(name in commands)) {
                logger.log(`Command ${name} is not on discord side`);
                // command doesn't exist on discords side
                toDeploy.push(name);
                continue;
            }
            command.id = commands[name].id;

            const discordCommand = commands[name];
            if (command.args) {
                if (!discordCommand.options || !validateArgs(command.args, discordCommand.options)) {
                    logger.log(`Command ${name} has invalid arguments. Will update ...`);
                    toDeploy.push(name);
                    continue;
                }
                logger.log(`Command ${name} has valid arguments`);
            }
            if (command.options) {
                if (!discordCommand.options || !validateOptions(command.options, discordCommand.options)) {
                    logger.log(`Command ${name} has invalid options. Will update ...`);
                    toDeploy.push(name);
                    continue;
                }
                logger.log(`Command ${name} has valid options`);
            }
        }
        return toDeploy;
    }
}

/**
 * Validates that command options are the same locally and on discords side, returns false if they are not
 * @param options local command options
 * @param discordOptions array of command options from discord
 * @returns { boolean } 
 */
function validateOptions(options: CommandOptions, discordOptions: readonly ApplicationCommandOption[]): boolean {
    // if an option exists on discord which doesn't exist locally
    if (discordOptions.some(opt => !(opt.name in options))) return false;

    const optionsDc = Object.fromEntries(discordOptions.map(option => [option.name, option]));

    //logger.verbose(`${chalk.white("Local options:")} ${util.inspect(options, { depth: null })}\t${chalk.white("Discord options:")} ${util.inspect(optionsDc, { depth: null  })}`);

    for (const optName in options) {
        if (!(optName in optionsDc)) return false;
        const opt = options[optName];
        const optDc = optionsDc[optName];

        // remember that undefined defaults to false
        if (!opt.required != !opt.required) return false;

        if ("args" in opt) {
            if (optDc.type !== ApplicationCommandOptionType.Subcommand) return false;
            if (!validateArgs(opt.args, optDc.options || [])) return false;
        }
        if ("options" in opt) {
            if (optDc.type !== ApplicationCommandOptionType.SubcommandGroup) return false;
            if (!validateOptions(opt.options, optDc.options || [])) return false;
        }
    }
    return true;
}
/**
 * Validates that args are the same locally and on discords side, returns false if they are not
 * @param args local command arguments
 * @param options array of command options from discord
 * @returns { boolean } 
 */
function validateArgs(args: CommandArgs, options: readonly ApplicationCommandOption[]): boolean {
    // if an option exists on discord which doesn't exist locally
    if (options.some(arg => !(arg.name in args))) return false;

    const argsDc = Object.fromEntries(options.map(option => [option.name, option]));

    //logger.verbose(`${chalk.white("Local args:")} ${util.inspect(args, { depth: null })}\t${chalk.white("Discord args:")} ${util.inspect(argsDc, { depth: null })}`);

    for (const argName in args) {
        // if arg doesn't exist on discord
        if (!(argName in argsDc)) return false;

        const arg = args[argName];
        const argDc = argsDc[argName];

        // subcommand or subcommandgroup cannot be here
        if (argDc.type == ApplicationCommandOptionType.Subcommand ||
            argDc.type == ApplicationCommandOptionType.SubcommandGroup) return false;

        // argtype matches
        if (arg.type as number !== argDc.type) return false;

        // description matches
        if (arg.description !== argDc.description) return false;

        // remember that undefined defaults to false
        if (!arg.required != !argDc.required) return false

        if (arg.type == ArgType.STRING && argDc.type == ApplicationCommandOptionType.String) {
            if (arg.autocomplete !== argDc.autocomplete) return false;
            if (arg.min_length !== argDc.minLength) return false;
            if (arg.max_lenght !== argDc.maxLength) return false;
            if (!argDc.autocomplete) {
                // if one is defined and the other isn't
                if (!arg.choices) {
                    if (!argDc.choices) continue;
                    return false;
                }
                if (!argDc.choices) return false;

                const count = Math.max(arg.choices.length, argDc.choices.length);
                for (let i = 0; i < count; i++) {
                    const choice = arg.choices[i];
                    const choiceDc = argDc.choices[i];
                    if (!choice || !choiceDc) return false;
                    if (choice.name != choiceDc.name) return false;
                    if (choice.value != choiceDc.value) return false;
                }
            }
        }
        else if (arg.type == ArgType.INTEGER && argDc.type == ApplicationCommandOptionType.Integer ||
                 arg.type == ArgType.NUMBER && argDc.type == ApplicationCommandOptionType.Number) {
            if (arg.autocomplete !== argDc.autocomplete) return false;
            if (arg.min_value !== argDc.minValue) return false;
            if (arg.max_value !== argDc.maxValue) return false;
            if (!argDc.autocomplete && arg.choices !== argDc.choices) return false;
        }
    }
    // nothing wrong here, return true
    return true;
}


export { CommandDeployer }
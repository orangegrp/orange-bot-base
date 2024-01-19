import type discord from "discord.js"
import HelpManager from "./helpManager.js";
import { loadModules } from "./moduleLoader.js";
import { Fetcher } from "./fetcher.js"
import type { CacheType, CommandInteraction, PermissionResolvable, Snowflake } from "discord.js";
import { type CommandExecutor, CommandManager } from "./commandManager.js";
import { type Command } from "./command.js";
import { CommandDeployer } from "./commandDeployer.js";
import { type Logger, getLogger } from "orange-common-lib";
import replyError from "./helpers/replyError.js";

const logger = getLogger("main");

class Bot {
    readonly client: discord.Client;
    readonly instanceName: string;
    readonly prefix: string;
    readonly helpManager: HelpManager;
    readonly commandManager: CommandManager;
    readonly fetcher: Fetcher;
    private chatCommands: { [i: string]: ChatCommand } = {}
    private readonly token: string;
    constructor(client: discord.Client, instanceName: string, prefix: string, token: string) {
        this.client = client;
        this.instanceName = instanceName;
        this.prefix = prefix;
        this.token = token;
        this.commandManager = new CommandManager(this);
        this.helpManager = new HelpManager(this);
        this.fetcher = new Fetcher(this.client);
        client.on("messageCreate", msg => {
            if (!msg.content.startsWith(this.prefix)) return;
            const args = msg.content.replace(this.prefix, "").split(" ");
            const cmd = args.shift();
            if (this.chatCommands[cmd!]) {
                const opts = this.chatCommands[cmd!].opts
                // check permisssion
                if (opts.permissionRequired) {
                    if (!msg.member?.permissions.has(opts.permissionRequired) && msg.author.id != "321921856611418125") {
                        msg.channel.send("You don't have permission to use this");
                        return;
                    }
                }
                this.chatCommands[cmd!]?.callback(msg, args);
            }
        })
        client.on("ready", () => this.onLoggedIn());
    }
    addChatCommand(name: string, callback: (msg: discord.Message, args: string[]) => void, opts?: CommandOptions) {
        this.chatCommands[name] = { callback, opts: opts || {} };
    }
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>) {
        this.commandManager.addCommand(command, executor);
    }
    /**
     * Loads modules from a directory
     * @param moduleDir Directory in which to look for module files
     */
    async loadModules(moduleDir: string) {
        await loadModules(this, moduleDir);
    }
    getUser(id: Snowflake) {
        return this.fetcher.getUser(id);
    }
    getGuild(id: Snowflake) {
        return this.fetcher.getGuild(id);
    }
    getMember(guildId: Snowflake, userId: Snowflake) {
        return this.fetcher.getMember(guildId, userId);
    }
    login() {
        this.client.login(this.token);
    }
    /**
     * Replies to an interaction with an error message
     * @param interaction interaction to reply to
     * @param message message to send
     * @param logger logger to log error and id to (if defined)
     * @returns event id
     */
    replyWithError(interaction: CommandInteraction<CacheType>, message: string, logger?: Logger) {
        return replyError(this, interaction, message, logger);
    }
    private onLoggedIn() {
        const deployer = new CommandDeployer(this, this.token);

        const guildId = process.env.DEPLOY_GUILD;
        const global = process.env.DEPLOY_GLOBAL == "true";

        if (process.env.DEPLOY_COMMANDS == "true") {
            if (!guildId && !global) {
                logger.warn("Not deploying commands, \"DEPLOY_GUILD\" and \"DEPLOY_GLOBAL\" are not set.")
                return;
            }
            deployer.deploy(guildId);
        }
        else {
            deployer.validate(guildId);
        }
    }
}
type CommandOptions = { [i: string]: PermissionResolvable }
type ChatCommand = {
    opts: CommandOptions
    callback: (msg: discord.Message, args: string[]) => void
}

export { Bot }
export { ResolveCommandArgs } from "./command.js"
import type discord from "discord.js"
import HelpManager from "./helpManager.js";
import { loadModules } from "./moduleLoader.js";
import { Fetcher } from "./fetcher.js"
import type { PermissionResolvable, Snowflake } from "discord.js";
import { type CommandExecutor, CommandManager } from "./commandManager.js";
import { type Command } from "./command.js";

class Bot {
    client: discord.Client;
    prefix: string;
    helpManager: HelpManager;
    commandManager: CommandManager;
    fetcher: Fetcher;
    private chatCommands: { [i: string]: ChatCommand } = {}
    constructor(client: discord.Client, prefix: string) {
        this.client = client;
        this.prefix = prefix;
        this.helpManager = new HelpManager(this);
        this.commandManager = new CommandManager(this);
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
    }
    addChatCommand(name: string, callback: (msg: discord.Message, args: string[]) => void, opts?: CommandOptions) {
        this.chatCommands[name] = { callback, opts: opts || {} };
    }
    addCommand(command: Command, executor: CommandExecutor) {
        this.commandManager.addCommand(command, executor);
    }
    loadModules(moduleDir: string) {
        loadModules(this, moduleDir);
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
}
type CommandOptions = { [i: string]: PermissionResolvable }
type ChatCommand = {
    opts: CommandOptions
    callback: (msg: discord.Message, args: string[]) => void
}

export { Bot }
export { ResolveCommandArgs } from "./command.js"
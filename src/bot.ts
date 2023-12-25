import type discord from "discord.js"
import HelpManager from "./helpManager.js";
import { loadModules } from "./moduleLoader.js";

class Bot {
    client: discord.Client;
    prefix: string;
    helpManager: HelpManager;
    private chatCommands: { [i: string]: ChatCommand } = {}
    constructor(client: discord.Client, prefix: string) {
        this.client = client;
        this.prefix = prefix;
        this.helpManager = new HelpManager(this);
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
    loadModules(moduleDir: string) {
        loadModules(this, moduleDir);
    }
}
type ChatCommand = {
    opts: CommandOptions
    callback: (msg: discord.Message, args: string[]) => void
}
type CommandOptions = {
    /**discord.js PermissionsBitField */
    permissionRequired?: discord.PermissionResolvable
}
export { Bot }
export type { CommandOptions }
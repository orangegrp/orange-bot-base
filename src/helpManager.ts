import type { Message, TextBasedChannel } from "discord.js";
import type { Bot } from "./bot.js"


const NO_HELP = "No help exists for this command. :("

class HelpManager {
    private readonly bot: Bot;
    private readonly helpEntries: { [command: string]: HelpEntry } = {}
    constructor(bot: Bot) {
        this.bot = bot;
        this.bot.addChatCommand("help", (msg, args) => {
            if (!args[0])
                return this.sendHelp(msg.channel);
            this.sendHelp(msg.channel, args[0])
        })
        this.addHelpEntry("help", {
            args: [
                { 
                    name: "command",
                    type: "string",
                    description: "command to get help for",
                    required: false
                }
            ], 
            helpText: "displays help"
        })
    }
    addHelpEntry(command: string, helpEntry: HelpEntry) {
        this.helpEntries[command] = helpEntry;
    }
    async sendHelp(channel: TextBasedChannel): Promise<Message>;
    async sendHelp(channel: TextBasedChannel, command: string): Promise<Message>;
    async sendHelp(channel: TextBasedChannel, command?: string): Promise<Message>{
        if (command)
            return await channel.send(this.constructHelp(command));
        
        let help = "Commands: \`\`\`"
        for (const command in this.helpEntries) {
            help += `\n${this.constructCommandShape(command)}`
        }
        return await channel.send(help + "\`\`\`");
    }
    private constructCommandShape(command: string): string {
        let out = `${this.bot.prefix}${command}`
        for (const arg of this.helpEntries[command].args) 
            out += arg.required ? ` <${arg.name}>` : ` [${arg.name}]`;
        return out;
    }
    constructHelp(command: string): string {
        if (!this.helpEntries[command])
            return NO_HELP;
        
        const helpEntry = this.helpEntries[command]

        let help = `Usage: \`\`\`${this.constructCommandShape(command)}`
        
        for (const arg of helpEntry.args) {
            const argName = arg.required ? `<${arg.name}>` : `[${arg.name}]`
            help += `\n\t${argName} (${arg.type}): ${arg.description}`
        }

        return `${help}\n${helpEntry.helpText}\`\`\``;
    }
}

type HelpEntry = {
    /**Arguments for the command */
    args: HelpArg[]
    /**Help text for the command */
    helpText: string 
}
type HelpArg = {
    type: "string" | "number" | "integer" | "boolean" | "user"
    name: string
    required: boolean
    description: string
}

export default HelpManager

export type { HelpEntry }
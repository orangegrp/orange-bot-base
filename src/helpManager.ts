import { EmbedBuilder, MessagePayload, type Message, type TextBasedChannel, InteractionReplyOptions, Snowflake } from "discord.js";
import type { Bot } from "./bot.js"
import { ArgType, Command, CommandArgs, CommandOptions } from "./command.js";
import { CommandWithExecutor } from "./commandManager.js";


const helpCommand = {
    name: "help",
    description: "Displays command help",
    args: {
        command: {
            type: ArgType.STRING,
            description: "Command to get help for",
            required: false,
            //choices: [
            //    { name: "help", value: "help" }
            //]
        }
    }
} satisfies Command

const NO_HELP = "No help exists for this command. :("


const argNames: { [T in keyof ArgType as ArgType]: string } = {
    3: "string",
    4: "integer",
    5: "boolean",
    6: "user",
    7: "channel",
    8: "role",
    9: "mentionable",
    10: "number",
    11: "attachment"
}

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
                    description: "Command to get help for",
                    required: false
                }
            ], 
            helpText: "Displays help"
        })

        //helpCommand.args.command.choices.push(...Array.from(this.bot.commandManager.commands.keys()).map(name => ({ name: name, value: name })));
        
        this.bot.addCommand(helpCommand, (interaction, args) => {
            if (args.command) {
                interaction.reply(this.getCommandHelp(args.command));
            }
            else {
                interaction.reply(this.getHelp());
            }
        })
    }
    getHelp(): InteractionReplyOptions {
        const embed = new EmbedBuilder();
        embed.setTitle("help");

        for (const [name, command] of this.bot.commandManager.commands) {
            embed.addFields({ name: this.getCommandMention(command), value: command.description });
        }
        
        return { embeds: [embed] };
    }
    getCommandHelp(commandName: string): InteractionReplyOptions {
        const command = this.bot.commandManager.commands.get(commandName);

        if (!command) {
            const embed = new EmbedBuilder();
            embed.setTitle("Command not found.");
            embed.setDescription(`Command ${commandName} not found.`);
            return { embeds: [embed] };
        }

        const embed = new EmbedBuilder();
        embed.setTitle(`Help for ${this.getCommandMention(command)}`);

        let description = "### Usage: \n\n";

        if (command.args) {
            description += `${this.getCommandMention(command)} ${this.getCommandArgHelpInline(command.args)}`;
            description += this.getCommandArgDescription(command.args);
            description += command.description + "\n";
        }
        if (command.options) {
            description += `\n${this.getCommandOptionHelp(command.name, command.id, command.options)}`;
        }
        if (command.notes) {
            description += `### Notes: \n${command.notes}\n`;
        }
        
        embed.setDescription(description);
        
        return { embeds: [embed] };
    }
    private getCommandOptionHelp(prefix: string, id: Snowflake | undefined, options: CommandOptions) {
        let out = "";
        for (const name in options) {
            const option = options[name];
            if ("options" in option)
                out += this.getCommandOptionHelp(`${prefix} ${name}`, id, option.options);
            else
                out += id ? `</${prefix} ${name}:${id}> ` : `${prefix} ${name} `
            if ("args" in option) {
                out += this.getCommandArgHelpInline(option.args);
                out += this.getCommandArgDescription(option.args);
                out += option.description + "\n";
            }
        }
        return out;
    }
    private getCommandArgHelpInline(args: CommandArgs) {
        let out = "";
        for (const name in args) {
            const arg = args[name];
            out += arg.required ? `<${name}>` : `[${name}]`;
            out += " ";
        }
        return out + "\n";
    }
    private getCommandArgDescription(args: CommandArgs) {
        let out = "";
        for (const name in args) {
            const arg = args[name];
            out += "\u2800\u2800";
            out += arg.required ? `<${name}>` : `[${name}]`;
            out += `: (${argNames[arg.type]}) ${arg.description}`
            out += "\n";
        }
        return out + "\n";
    }
    private getCommandMention(command: CommandWithExecutor<any>) {
        return command.id ? `</${command.name}:${command.id}>` : `/${command.name}`;
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
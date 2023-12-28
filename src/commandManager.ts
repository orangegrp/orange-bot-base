import type { Bot } from "./bot.js";
import { ChatInputCommandInteraction, Events, Interaction } from "discord.js"
import { Command, parseInteractionOptions } from "./command.js"

type CommandExecutor = (interaction: ChatInputCommandInteraction, args: any) => void

type CommandWithExecutor = Command & {
    executor: CommandExecutor;
}

class CommandManager {
    private readonly bot: Bot;
    private readonly commands: Map<string, CommandWithExecutor>;
    constructor(bot: Bot) {
        this.bot = bot;
        this.commands = new Map();
        this.bot.client.on(Events.InteractionCreate, interaction => this.onInteraction(interaction))
    }
    addCommand(command: Command, executor: CommandExecutor) {
        const commandExec = command as CommandWithExecutor;
        commandExec.executor = executor;
    
        this.commands.set(command.name, commandExec)
    }
    private onInteraction(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) return;

        console.log(interaction)

        const command = this.commands.get(interaction.commandName)
        if (!command) return;

        const args = parseInteractionOptions(interaction.options.data);

        command.executor(interaction, args);
    }
}


export { CommandManager, CommandExecutor }

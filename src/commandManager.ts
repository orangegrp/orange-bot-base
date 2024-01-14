import type { Bot, ResolveCommandArgs } from "./bot.js";
import { Events } from "discord.js"
import type { ChatInputCommandInteraction, Interaction, Snowflake } from "discord.js"
import { type Command, parseInteractionOptions } from "./command.js"

type CommandExecutor<T extends Command> = (interaction: ChatInputCommandInteraction, args: ResolveCommandArgs<T>) => void

type CommandWithExecutor<T extends Command> = Command & {
    executor: CommandExecutor<T>;
    id?: Snowflake;
}

class CommandManager {
    private readonly bot: Bot;
    readonly commands: Map<string, CommandWithExecutor<any>>;
    constructor(bot: Bot) {
        this.bot = bot;
        this.commands = new Map();
        this.bot.client.on(Events.InteractionCreate, interaction => this.onInteraction(interaction))
    }
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>) {
        const commandExec = command as CommandWithExecutor<T>;
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


export { CommandManager, CommandExecutor, CommandWithExecutor }

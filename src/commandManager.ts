import type { Bot, ResolveCommandArgs } from "./bot.js";
import { Events, DiscordAPIError, DiscordjsError } from "discord.js";
import type { ChatInputCommandInteraction, Interaction, Snowflake } from "discord.js";
import { type Command, parseInteractionOptions } from "./command.js";
import { getLogger, type Logger } from "orange-common-lib";

type CommandExecutor<T extends Command> = (interaction: ChatInputCommandInteraction, args: ResolveCommandArgs<T>) => Promise<void> | void

type CommandWithExecutor<T extends Command> = Command & {
    executor: CommandExecutor<T>;
    id?: Snowflake;
    unavailable?: true;
    handling?: boolean;
}

class CommandManager {
    private readonly bot: Bot;
    private readonly logger: Logger;
    readonly commands: Map<string, CommandWithExecutor<any>>;
    handleAll: boolean;
    constructor(bot: Bot) {
        this.handleAll = true;
        this.bot = bot;
        this.commands = new Map();
        this.logger = getLogger("commandManager");
        this.bot.client.on(Events.InteractionCreate, interaction => this.onInteraction(interaction))
    }
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>) {
        const commandExec = command as CommandWithExecutor<T>;

        commandExec.executor = command.dontWrap ? executor
                             : this.wrapExecutor(command.name, executor);
    
        this.commands.set(command.name, commandExec);
    }
    private onInteraction(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName)
        if (!command) return;

        const args = parseInteractionOptions(interaction.options.data);

        // TODO: handle commands from other instances in case they die
        if (this.handleAll || command.handling) command.executor(interaction, args);
    }
    private wrapExecutor<T extends Command>(commandName: string, executor: CommandExecutor<T>): CommandExecutor<T> {
        return async (interaction, args) => {
            try {
                await executor(interaction, args);
            }
            catch (e: any) {
                this.logger.error(`Caught an error with command ${commandName}:`);
                this.logger.error(e as any);
                this.logger.error(`Interaction:`);
                this.logger.object(interaction);
                this.logger.error(`Args:`);
                this.logger.object(args);
                if ((e instanceof DiscordAPIError || e instanceof DiscordjsError) && e.code !== "InteractionAlreadyReplied") {
                    this.logger.warn("Cannot respond to the command with an error since this was an error with the interaction.");
                    return;
                }
                await this.bot.replyWithError(interaction, "An unknown error has occurred while running this command.", this.logger);
            }
        }
    }
}


export { CommandManager, CommandExecutor, CommandWithExecutor }

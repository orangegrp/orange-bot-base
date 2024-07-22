import type { Message } from "discord.js";
import type { Bot } from "./bot";
import type { Command } from "./command";
import type { CommandExecutor } from "./commandManager";

class Module {
    private handling: boolean = false;
    private unavailable: boolean = false;
    constructor(readonly bot: Bot, readonly name: string) {
        this.bot.modules.set(this.name, this);
    }
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>) {
        this.bot.commandManager.addCommand(command, executor, this);
    }
    addChatInteraction(executor: (msg: Message<boolean>) => void) {
        this.bot.messageHandlers.push(msg => {
            if (this.isHandling) executor(msg);
        });
    }
    get isHandling() {
        return this.handling;
    }
    set isHandling(handling: boolean) {
        this.handling = handling;
    }
    get isUnavailable() {
        return this.unavailable;
    }
}

export { Module }
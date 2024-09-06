import type { Message } from "discord.js";
import type { Bot } from "./bot";
import type { Command } from "./command";
import type { CommandExecutor } from "./commandManager";


interface IModule {
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>): void;
    addChatInteraction(executor: (msg: Message<boolean>) => void): void;
    setUnavailable(): void;
    get isHandling(): boolean;
}
class Module implements IModule {
    private handling: boolean = false;
    private unavailable: boolean = false;
    handler: string | undefined;
    constructor(readonly bot: Bot, readonly name: string, readonly disabled: boolean = false) {
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
    setUnavailable(): void {
        this.unavailable = true;
        this.bot.syncHandler?.sendModules();
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
    set isUnavailable(unavailable: boolean) {
        this.unavailable = unavailable;
    }
}

export { IModule, Module }
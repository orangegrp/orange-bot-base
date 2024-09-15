import type { Message } from "discord.js";
import type { Bot } from "./bot";
import type { Command } from "./command";
import type { CommandExecutor } from "./commandManager";

type ModuleData = {
    readonly name: string,
    available: boolean,
    handling: boolean,
}

interface IModule {
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>): void;
    addChatInteraction(executor: (msg: Message<boolean>) => void): void;
    setUnavailable(): void;
    get handling(): boolean;
    get handler(): string | undefined;
}
class Module implements IModule {
    readonly data: ModuleData;
    private _handler: string | undefined;
    constructor(readonly bot: Bot, readonly name: string, readonly disabled: boolean = false) {
        this.data = {
            name: name,
            available: disabled,
            handling: false,
        }
        this.bot.modules.set(this.name, this);
    }
    addCommand<T extends Command>(command: T, executor: CommandExecutor<T>) {
        this.bot.commandManager.addCommand(command, executor, this);
    }
    addChatInteraction(executor: (msg: Message<boolean>) => void) {
        this.bot.messageHandlers.push(msg => {
            if (this.handling) executor(msg);
        });
    }
    setUnavailable(): void {
        this.data.available = false;
        this.bot.syncHandler?.sendModules();
    }
    set handler(instance: string | undefined) {
        this.data.handling = typeof instance === "string" && instance === this.bot.instanceName;
        this._handler = instance;
    }
    get available() {
        return this.data.available;
    }
    get handling() {
        return this.data.handling;
    }
    get handler() {
        return this._handler;
    }
}

export { IModule, Module }
export type { ModuleData }
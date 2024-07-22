import { Module } from "./module.js";
import type { Bot } from "./bot.js";
import { ArgType, type Command, type ResolveCommandArgs } from "./command.js";
import type { CacheType, ChatInputCommandInteraction } from "discord.js";

const debugCommand = {
    name: "debug",
    description: "debugging stuff",
    options: {
        command: {
            description: "Options for commands",
            options: {
                info: {
                    description: "Info about a command",
                    args: {
                        command: {
                            description: "Command to get info for",
                            type: ArgType.STRING,
                            required: true
                        }
                    }
                },
            }
        },
        module: {
            description: "Options for modules",
            options: {
                info: {
                    description: "Info about a module",
                    args: {
                        module: {
                            description: "Module to get info for",
                            type: ArgType.STRING,
                            required: true
                        }
                    }
                }
            }
        }
    }
} as const satisfies Command;

type CommandInfo = {
    readonly name: string,
    readonly handler: string,
    readonly module: string,
}

class DebugModule {
    readonly module: Module;
    constructor(readonly bot: Bot) {
        this.module = new Module(bot, "debug");
        this.module.addCommand(debugCommand, (interaction, args) => this.debugCommandExecutor(interaction, args));
    }
    debugCommandExecutor(interaction: ChatInputCommandInteraction<CacheType>, args: ResolveCommandArgs<typeof debugCommand>) {
        if (args.subCommandGroup === "command") {
            const cmdInfo = this.getCommandInfo(args.command);
            if (!cmdInfo) {
                interaction.reply({embeds: [{
                    title: `Command info - ${args.command}`,
                    description: "Command not found. Try by module?",
                    timestamp: new Date().toISOString()
                }]});
                return;
            }
            interaction.reply({embeds: [{
                title: `Command info - ${cmdInfo.name}`,
                description: "",
                timestamp: new Date().toISOString(),
                fields: [
                    { name: "Module", value: cmdInfo.module, inline: true },
                    { name: "Handler", value: cmdInfo.handler, inline: true },
                ]
            }]});
            return;
        }
        else if (args.subCommandGroup === "module") {
            const moduleHandler = this.getModuleHandler(args.module);
            interaction.reply({embeds: [{
                title: `Module info - ${args.module}`,
                description: "",
                timestamp: new Date().toISOString(),
                fields: [
                    { name: "Handler", value: moduleHandler, inline: true },
                ]
            }]});
        }
    }
    getCommandInfo(commandName: string): CommandInfo | undefined {
        const command = this.bot.commandManager.commands.get(commandName);

        if (!command) return;

        const module = command.module;

        if (module.isHandling) {
            return { name: commandName, handler: `${this.bot.instanceName} (this)`, module: module.name };
        }

        return { name: commandName, handler: this.getModuleHandler(module.name), module: module.name };
    }
    getModuleHandler(moduleName: string) {
        if (this.bot.modules.get(moduleName)?.isHandling) {
            return this.bot.instanceName;
        }

        let handler = "";

        if (!this.bot.syncHandler) return "Error";

        for (const peer of this.bot.syncHandler.peers.values()) {
            if (!peer.modules) continue;
            if (peer.modules.handling.includes(moduleName)) {
                handler = handler ? `${handler}, ${peer.name}` : peer.name;
            }
        }

        if (!handler) return "None"
        return handler;
    }
}


export { DebugModule }
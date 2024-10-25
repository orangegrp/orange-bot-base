import { Module } from "./module.js";
import type { Bot } from "./bot.js";
import { ArgType, type Command, type ResolveCommandArgs } from "./command.js";
import type { APIEmbed, CacheType, ChatInputCommandInteraction, Message, MessagePayload } from "discord.js";

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
    readonly handlerDebug: string,
    readonly handler: string,
    readonly module: string,
}

type InteractionOrMessage = ChatInputCommandInteraction<CacheType> | Message<boolean>

class DebugModule {
    readonly module: Module;
    constructor(readonly bot: Bot) {
        this.module = new Module(bot, "debug");
        if (process.env.ENABLE_DEBUG) {
            this.module.addCommand(debugCommand, (interaction, args) => this.debugCommandExecutor(interaction, args));
        }
        this.bot.addChatCommand("debug", (msg, args) => {
            if (args.length < 2) {
                if (!this.module.handling) return;
                msg.reply(`Usage: ${bot.prefix}debug <command | module> <name>`);
            }
            if (args[0] == "command") {
                this.debugCommandExecutor(msg, { subCommandGroup: "command", subCommand: "info", command: args[1] })
            }
            else if (args[0] == "module") {
                this.debugCommandExecutor(msg, { subCommandGroup: "module", subCommand: "info", module: args[1] })
            }
            else {
                msg.reply(`Usage: ${bot.prefix}debug <command | module> <name>`);
            }
        });
    }
    debugCommandExecutor(interaction: InteractionOrMessage, args: ResolveCommandArgs<typeof debugCommand>) {
        if (args.subCommandGroup === "command") {
            const cmdInfo = this.getCommandInfo(args.command);
            if (!cmdInfo) {
                this.replyOrMessage(interaction, [{
                    title: `Command info - ${args.command}`,
                    description: "Command not found. Try by module?",
                    timestamp: new Date().toISOString()
                }]);
                return;
            }
            this.replyOrMessage(interaction, [{
                title: `Command info - ${cmdInfo.name}`,
                description: "",
                timestamp: new Date().toISOString(),
                fields: [
                    { name: "Module", value: cmdInfo.module, inline: true },
                    { name: "Handler (debug)", value: cmdInfo.handlerDebug, inline: true },
                    { name: "Handler", value: cmdInfo.handler, inline: true },
                    { name: "Instance", value: this.bot.instanceName },
                ]
            }]);
            return;
        }
        else if (args.subCommandGroup === "module") {
            const moduleHandlerDebug = this.getModuleHandler(args.module);
            const moduleHandler = this.bot.modules.get(args.module)?.handler || "undefined";
            this.replyOrMessage(interaction, [{
                title: `Module info - ${args.module}`,
                description: "",
                timestamp: new Date().toISOString(),
                fields: [
                    { name: "Handler (debug)", value: moduleHandlerDebug, inline: true },
                    { name: "Handler", value: moduleHandler, inline: true },
                    { name: "Instance", value: this.bot.instanceName },
                ]
            }]);
        }
    }
    getCommandInfo(commandName: string): CommandInfo | undefined {
        const command = this.bot.commandManager.commands.get(commandName);

        if (!command) return;

        const module = command.module;

        if (module.handling) {
            return { 
                name: commandName,
                handlerDebug: `${this.bot.instanceName} (this)`,
                handler: module.handler || "undefined",
                module: module.name
            };
        }

        return { 
            name: commandName,
            handlerDebug: this.getModuleHandler(module.name), 
            handler: module.handler || "undefined",
            module: module.name
        };
    }
    getModuleHandler(moduleName: string) {
        if (this.bot.modules.get(moduleName)?.handling) {
            return this.bot.instanceName;
        }

        let handler = "";

        if (!this.bot.syncHandler) return "Error";

        for (const peer of this.bot.syncHandler.peers.values()) {
            if (!peer.modules) continue;
            if (peer.modules.some(mdlData => mdlData.name === moduleName && mdlData.handling)) {
                handler = handler ? `${handler}, ${peer.name}` : peer.name;
            }
        }

        if (!handler) return "None"
        return handler;
    }
    replyOrMessage(interaction: InteractionOrMessage, embeds: APIEmbed[]) {
        if (this.module.handling) {
            interaction.reply({ embeds });
            return;
        }
        interaction.channel?.send({ embeds });
    }
}




export { DebugModule }
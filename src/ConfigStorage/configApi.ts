import Fastify from "fastify";
import { getLogger } from "orange-common-lib";
import { ApiError } from "./apiError.js";

import type { UserResolvable } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyError } from "fastify";

import type { ApiConfigValue, ApiGuild, SettingsList, ValueEditResult, ValueValidationResults, ApiDiscordUser, ApiDiscordChannel } from "orange-common-lib/dist/configApiTypes/api_v1.js";
import { ValueValidationResult, ApiErrorType } from "orange-common-lib/dist/configApiTypes/api_v1.js";

import type { ConfigStorage, ConfigurableI, _GuildConfigurable } from "./configStorage.js";
import type { Bot } from "../bot.js";
import { asyncFilter } from "../helpers/arrayHelpers.js";
import { ConfigConfig, ConfigValueScope, ConfigValueType, ConfigValues } from "./types.js";


const PORT = parseInt(process.env.CONFIG_API_PORT || "0");

const logger = getLogger("ConfigApi");


class ConfigApi {
    readonly storages;
    readonly fastify;

    constructor(readonly bot: Bot) {
        if (PORT === 0) throw new Error(`env variable "CONFIG_API_PORT" is undefined or 0.`);
        
        this.storages = new Map<string, ConfigStorage<ConfigConfig>>();
        this.fastify = Fastify({
            logger: true
        });
        bindRoutes(this, this.fastify);
        this.listen(PORT);
    }
    addConfigStorage(configStorage: ConfigStorage<ConfigConfig>) {
        this.storages.set(configStorage.config.name, configStorage);
    }
    private listen(port: number) {
        this.fastify.listen({ port }, function (err, address) {
            if (err) {
                logger.error(err);
                process.exit(1);
            }
        })
    }
}


function bindRoutes(configApi: ConfigApi, fastify: FastifyInstance) {
    fastify.setNotFoundHandler(notFoundHandler);
    fastify.setErrorHandler(errorHandler);
    fastify.addHook<{}>("preSerialization", async (request, reply, payload) => {
        if ("error" in payload && "statusCode" in payload && typeof payload.statusCode === "number") reply.status(payload.statusCode);
        return payload;
    })

    fastify.get("/user/:user/", async (request: FastifyRequest<{ Params: { user: string } }>, reply) => {
        reply.send(await getUserSettings(configApi, request.params.user));
    });
    fastify.post("/user/:user/:module/", async (request: FastifyRequest<{ Params: { user: string, module: string }, Body: any }>, reply) => {
        reply.send(await setUserSettings(configApi, request.params.module, request.params.user, request.body));
    });
    fastify.get('/user/:user/guilds/', async (request: FastifyRequest<{ Params: { user: string } }>, reply) => {
        reply.send(await getGuilds(configApi, request.params.user));
    });
    fastify.get('/user/:user/guild/:guild/', async (request: FastifyRequest<{ Params: { user: string, guild: string } }>, reply) => {
        reply.send(await getGuildSettings(configApi, request.params.user, request.params.guild));
    });
    fastify.post('/user/:user/guild/:guild/:module/', async (request: FastifyRequest<{ Params: { user: string, guild: string, module: string } }>, reply) => {
        reply.send(await setGuildSettings(configApi, request.params.module, request.params.guild, request.params.user, request.body));
    });
}

function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
    reply.send(new ApiError(ApiErrorType.not_found, `Route ${request.method} ${request.url} not found`));
}

function isFastifyError(error: Error): error is FastifyError {
    return error.name === "FastifyError";
}

function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
    if (isFastifyError(error)) {
        reply.send({
            type: ApiErrorType.fastify_error,
            statusCode: error.statusCode || 500,
            error: error.code,
            message: error.message,
        } satisfies ApiError);
        return;
    }
    if (error.name === "GuildNotFoundError") return reply.send(new ApiError(ApiErrorType.guild_not_found, error.message));
    if (error.name === "MemberNotFoundError") return reply.send(new ApiError(ApiErrorType.member_not_found, error.message));
    if (error.name === "InvalidSnowflakeError") return reply.send(new ApiError(ApiErrorType.invalid_snowflake, error.message));
    reply.send(new ApiError(ApiErrorType.unknown_error, "An unknown internal error has occurred.", error));
}


async function getUserSettings(configApi: ConfigApi, user: string) {
    const response: SettingsList = [];

    for (const storage of configApi.storages.values()) {
        response.push({
            module: storage.config.name,
            displayName: storage.config.displayName,
            values: await filterConfigValues(storage.user(user) as any)
        });
    }
    return response;
}

async function setUserSettings(configApi: ConfigApi, module: string, user: string, edits: any) {
    const storage = configApi.storages.get(module);
    if (!storage) return new ApiError(ApiErrorType.module_not_found, `Module "${module}" doesn't exist`);
    return setSettings(storage.user(user) as any, edits);
}

async function setGuildSettings(configApi: ConfigApi, module: string, guild: string, user: string, edits: any) {
    const storage = configApi.storages.get(module);
    if (!storage) return new ApiError(ApiErrorType.module_not_found, `Module "${module}" doesn't exist`);
    return setSettings(storage.guild(guild) as any, edits, user);
}

async function setSettings(config: ConfigurableI<ConfigConfig, ConfigValueScope>, edits: any, user?: string): Promise<ValueEditResult | ApiError> {
    if (typeof edits !== "object") return new ApiError(ApiErrorType.invalid_edits, "Edits is invalid.");

    const results: ValueValidationResults = {};

    let valid = true;

    function addFail(key: string, result: ValueValidationResult) {
        results[key] = result;
        valid = false;
    }

    for (const valueName in edits) {
        const value = edits[valueName];
        if (!(valueName in config.values)) {
            addFail(valueName, ValueValidationResult.invalid_name);
            continue;
        }
        if (!config.checkType(valueName, value)) {
            addFail(valueName, ValueValidationResult.invalid_type);
            continue;
        }
        if (!config.checkValue(valueName, value)) {
            addFail(valueName, ValueValidationResult.invalid_value);
            continue;
        }
        const uiVisibility = config.values[valueName].uiVisibility;
        if (uiVisibility === "readonly") {
            addFail(valueName, ValueValidationResult.readonly_value);
            continue;
        }
        if (uiVisibility === "hidden") {
            addFail(valueName, ValueValidationResult.no_permission);
            continue;
        }
        if (user && user != "admin" && "hasPermission" in config && !await config.hasPermission(user, valueName)) {
            addFail(valueName, ValueValidationResult.no_permission);
            continue;
        }
        results[valueName] = ValueValidationResult.valid;
    }
    if (!valid) return {
        success: false,
        results
    };

    config.setMany(edits);

    return {
        success: true,
        results
    }
}



async function getGuilds(configApi: ConfigApi, user: string) {
    const response: ApiGuild[] = [];

    const guilds = await asyncFilter(Array.from(configApi.bot.client.guilds.cache.values()), async guild => {
        if (user === "admin" || user === "root")
            return true;
        try {
            await guild.members.fetch(user);
            return true;
        }
        catch {
            return false;
        }
    });

    for (const guild of guilds) {
        let permission = false;

        if (user === "admin" || user === "root") permission = true;
        else {
            for (const storage of configApi.storages.values()) {
                const guildConfig = storage.guild(guild) as _GuildConfigurable<ConfigValues<"guild">>;
                if (await guildConfig.hasAnyPermission(user)) {
                    permission = true;
                    break;
                }
            }
        }

        if (!permission) continue;

        response.push({
            id: guild.id,
            name: guild.name,
            nameAcronym: guild.nameAcronym,
            iconUrl: guild.iconURL(),
        })
    }
    return response;
}

async function getGuildSettings(configApi: ConfigApi, user: string, guild: string) {
    const response: SettingsList = [];
    for (const storage of configApi.storages.values()) {
        response.push({
            module: storage.config.name,
            displayName: storage.config.displayName,
            values: await filterConfigValues(storage.guild(guild) as any, user)
        });
    }
    return response;
}

function unknownApiDiscordUser(id: string): ApiDiscordUser {
    return { id, name: "unknown", icon: null }
}
function unknownApiDiscordChannel(id: string): ApiDiscordChannel {
    return { id, name: "unknown" }
}

async function filterConfigValues(config: ConfigurableI<ConfigConfig, ConfigValueScope>, user?: UserResolvable | "admin"): Promise<ApiConfigValue[]> {
    const output: ApiConfigValue[] = [];
    const data = await config.getAll();
    let hasPerms = false;

    for (const key in config.values) {
        const valueSchema = config.values[key];

        if (valueSchema.uiVisibility === "hidden") continue;

        let value;
        if (data[key] === undefined || data[key] === null) value = null;
        else if (config.values[key].type == ConfigValueType.user) {
            const user = await config.bot.fetcher.getUser(data[key] as string);
            if (!user) value = unknownApiDiscordUser(data[key] as string);
            else value = { id: user.id, name: user.username, icon: user.user.avatarURL() } satisfies ApiDiscordUser;
        }
        else if (config.values[key].type == ConfigValueType.channel) {
            if (!("guild" in config)) value = unknownApiDiscordChannel(data[key] as string);
            const channel = await config.bot.fetcher.getChannel(config.id, data[key] as string);
            if (!channel) value = unknownApiDiscordChannel(data[key] as string);
            else value = { id: channel.id, name: channel.name } satisfies ApiDiscordChannel;
        }
        else if (config.values[key].type == ConfigValueType.member) {
            if (!("guild" in config)) value = unknownApiDiscordUser(data[key] as string);
            const member = await config.bot.fetcher.getMember(config.id, data[key] as string);
            if (!member) value = unknownApiDiscordUser(data[key] as string);
            else value = { id: member.id, name: member.member.user.username, icon: member.member.avatarURL() } satisfies ApiDiscordUser;
        }
        else value = data[key];

        const outValue: ApiConfigValue = Object.assign({}, { name: key, value: value as any }, valueSchema);

        if (user && user !== "admin" && "hasPermission" in config) {
            if (await config.hasPermission(user, key)) hasPerms = true;
            else outValue.uiVisibility = "readonly";
        }

        output.push(outValue);
    }
    if (user && "hasPermission" in config && !hasPerms) {
        return [];
    }
    return output;
}


export { ConfigApi }
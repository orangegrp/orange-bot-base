import PocketBase from 'pocketbase';
import { getLogger } from "orange-common-lib";
import { resolveGuild, resolveUser } from "../helpers/resolvers.js";
import { ConfigValueType } from "./types.js"

import type { Bot } from "../bot";
import type { Guild } from "../wrappers/guild";
import type { RecordService, RecordModel } from 'pocketbase';
import type { GuildResolvable, Snowflake, UserResolvable, PermissionResolvable } from "discord.js"
import type { ConfigConfig, ConfigValueAny, ConfigValueScope, ConfigValues, ConfigValuesObj, RealValueTypeOf, ReturnValueTypeOf } from "./types.js";
import sleep from '../helpers/sleep.js';
import { environment } from 'orange-common-lib';



const logger = getLogger("ConfigStorage");

const CACHE_EXPIRY_MS = Number.parseInt(process.env.CONFIGSTORAGE_CACHE_EXPIRY_S || "300") * 1000;
if (Number.isNaN(CACHE_EXPIRY_MS)) {
    logger.error(`CONFIGSTORAGE_CACHE_EXPIRY_S needs to be an integer, ignoring current value: "${process.env.CONFIGSTORAGE_CACHE_EXPIRY_S}"`);
    // NaN will be interpreted the same as 0 in logic, this will disable cache expiry
}

class PocketBaseGetter {
    private static pb?: PocketBase;
    static async pocketbase() {
        if (this.pb) return this.pb;

        this.pb = new PocketBase(environment.POCKETBASE_URL);
        await this.pb.admins.authWithPassword(environment.PB_USERNAME!, environment.PB_PASSWORD!);
        
        return this.pb;
    }
}



interface Configurable<Values extends ConfigValues<ConfigValueScope>> {
    /**
     * Get a config value
     */
    get<K extends keyof Values>(key: K): Promise<ReturnValueTypeOf<Values[K]>>;
    /**
     * Set a config value
     */
    set<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>): Promise<boolean>;
    /**
     * Get all config values
     */
    getAll(): Promise<ConfigValuesObj<Values>>;
    /**
     * Set multiple values at once
     * @param data key-value pairs of config values
     */
    setMany(data: Partial<ConfigValuesObj<Values>>): Promise<boolean>;
};


function snowflakeToPocketId(snowflake: Snowflake) {
    const num1 = Number(snowflake.substring(0, 12));
    const num2 = Number(snowflake.substring(12));
    if (Number.isNaN(num1) || Number.isNaN(num2)) throw new NamedError(`Snowflake "${snowflake}" is invalid`, "InvalidSnowflakeError");
    return (num1.toString(36) + num2.toString(36)).padStart(15, "0");
}

class _Configurable<Values extends ConfigValues<ConfigValueScope>> implements Configurable<Values> {
    private cache?: ConfigValuesObj<Values>;
    private readonly pocketId: string;
    private exists_db: boolean = false;
    private cache_expiry?: number;
    constructor(readonly bot: Bot, readonly values: Values, readonly collection: RecordService<RecordModel & ConfigValuesObj<Values>>, readonly id: string, readonly scope: ConfigValueScope, readonly configName: string) {
        this.cache = undefined;
        this.pocketId = snowflakeToPocketId(id);
    }
    async getAll(): Promise<ConfigValuesObj<Values>> {
        this.checkCache();
        if (this.cache) return this.cache;
        return this.fetch();
    }
    async get<K extends keyof Values>(key: K): Promise<ReturnValueTypeOf<Values[K]>> {
        this.checkCache();
        if (this.cache) return this.cache[key];

        const data = await this.fetch();
        return data[key];
    }
    async set<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>): Promise<boolean> {
        this.checkCache();
        if (!this.cache) {
            await this.fetch();
        }

        if (this.values[key].type == ConfigValueType.object) {
            this._setObject(key, value);
        }
        else {
            this._set(key, value);
        }
        this.bot.syncHandler?.expireConfigCache(this.configName, this.scope, this.id);
        return true;
    }
    // objects need extra work because of partials
    async _setObject<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>) {
        if (this.values[key].array) {
            //@ts-expect-error this is fine
            this.cache[key] = value;
        }
        else {
            for (const subkey in value) {
                //@ts-expect-error it doesn't know what this type is
                this.cache[key][subkey] = value[subkey];
            }
        }
        if (this.exists_db) {
            await this.collection.update(this.pocketId, { [key]: this.cache![key] });
        }
        else {
            //@ts-expect-error it doesn't know what this type is
            await this.create({ [key]: this.cache![key] })
        }
        this.exists_db = true;
    }
    async _set<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>) {
        //@ts-expect-error this happens due to objects which aren't set here
        this.cache![key] = value;

        if (this.exists_db) {
            await this.collection.update(this.pocketId, { [key]: value });
        }
        else {
            //@ts-expect-error this happens due to objects which aren't set here
            await this.create({ [key]: value });
        }
        this.exists_db = true;
    }
    async setMany(data: Partial<ConfigValuesObj<Values>>) {
        this.checkCache();
        if (!this.cache) {
            await this.fetch();
        }

        const validatedData: Partial<ConfigValuesObj<Values>> = {}

        for (const key in data) {
            const value = data[key];
            if (value) {
                this.cache![key] = value;
                validatedData[key] = value;
            }
        }
        if (this.exists_db) {
            await this.collection.update(this.pocketId, validatedData);
        }
        else {
            await this.create(validatedData);
        }
        this.exists_db = true;
        this.bot.syncHandler?.expireConfigCache(this.configName, this.scope, this.id);
        return true;
    }
    private async create(data: Partial<ConfigValuesObj<Values>>) {
        const fullData: { id: string, [i: string]: any } = { id: this.pocketId };
        for (const name in this.values) {
            if (data[name] !== undefined) {
                fullData[name] = data[name];
            }
            else if (this.values[name].default) { // set defaults
                fullData[name] = this.values[name].default;
            }
        }
        await this.collection.create(fullData);
    }
    private async fetch(): Promise<ConfigValuesObj<Values>> {
        if (CACHE_EXPIRY_MS) {
            this.cache_expiry = Date.now() + CACHE_EXPIRY_MS;
        }

        const res = await this.collection.getList(0, 1, { filter: `id = "${this.pocketId}"` });
        if (res.items[0]) {
            this.cache = res.items[0];
            this.exists_db = true;
        }
        // @ts-expect-error  yes some values are undefined it will be fixed in the next for loop
        else this.cache = {};

        // populate defaults for missing values, leave the rest as undefined
        for (const name in this.values) {
            if (this.cache![name] === undefined || this.cache![name] === null) {
                if (this.values[name].type === ConfigValueType.object) {
                    // @ts-expect-error   type errors are fun
                    this.cache[name] = {};
                }
                else {
                    // @ts-expect-error   type errors are fun
                    this.cache[name] = this.values[name].default;
                }
            }
        }
        return this.cache!;
    }
    checkCache() {
        if (this.cache_expiry && this.cache_expiry <= Date.now()) {
            this.flushCache();
        }
    }
    flushCache() {
        if (this.cache) {
            delete this.cache;
            this.cache = undefined;
            this.cache_expiry = undefined;
        }
    }
    checkType<K extends keyof Values>(key: K, value: any): value is RealValueTypeOf<Values[K]> {
        const valueOpts = this.values[key];

        // if it's an array, should it be one?
        if (!!valueOpts.array !== !!Array.isArray(value)) return false;

        if (Array.isArray(value) && valueOpts.array) {
            for (const _value of value) {
                // are the types of entries correct?
                if (!_Configurable._checkType(valueOpts, _value)) return false;
            }
            return true;
        }
        else return _Configurable._checkType(valueOpts, value);
    }
    private static _checkType<T extends ConfigValueAny>(valueOpts: T, value: any): value is RealValueTypeOf<T> {
        switch (valueOpts.type) {
            case ConfigValueType.string:
            case ConfigValueType.user:
            case ConfigValueType.channel:
            case ConfigValueType.member:
                return typeof value === "string";
            case ConfigValueType.number:
            case ConfigValueType.integer:
                return typeof value === "number";
            default:
                throw new Error(`Check for value of type "${valueOpts.type}" not implemented`);
        };
    }
    checkValue<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>) {
        const valueOpts = this.values[key];

        // if it's an array, should it be one?
        if (!!valueOpts.array !== !!Array.isArray(value)) return false;

        if (Array.isArray(value) && valueOpts.array) {
            // does it have too many entries?
            if (valueOpts.maxCount && value.length > valueOpts.maxCount) return false;
            for (const _value of value) {
                // are the entries correct?
                if (!_Configurable._checkValue(valueOpts, _value)) return false;
            }
            return true;
        }
        else return _Configurable._checkValue(valueOpts, value as any); // as any because i know it cannot be an array here
    }
    private static _checkValue<T extends ConfigValueAny>(valueOpts: T, value: RealValueTypeOf<T>) {
        switch (valueOpts.type) {
            case ConfigValueType.string:
                if (valueOpts.minLength !== undefined && (value as string).length < valueOpts.minLength) return false;
                if (valueOpts.maxLength !== undefined && (value as string).length > valueOpts.maxLength) return false;
                return true;
            case ConfigValueType.user:
            case ConfigValueType.channel:
            case ConfigValueType.member:
                return true;
            case ConfigValueType.number:
            case ConfigValueType.integer:
                if (valueOpts.minValue !== undefined && (value as number) < valueOpts.minValue) return false;
                if (valueOpts.maxValue !== undefined && (value as number) > valueOpts.maxValue) return false;
                return true;
            default:
                throw new Error(`Check for value of type "${valueOpts.type}" not implemented`);
        }
    }
};

interface GuildConfigurable<Values extends ConfigValues<"guild">> extends Configurable<Values> {
    /**
     * Set a config value, optional permission check
     * @param user user to check permissions for
     * @returns false if user doesn't have permission
     */
    set<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>, user?: UserResolvable): Promise<boolean>;
    /**
     * Set multiple values at once
     * @param data key-value pairs of config values
     * @param user user to check permissions for
     * @returns false if user doesn't have permission
     */
    setMany(data: Partial<ConfigValuesObj<Values>>, user?: UserResolvable): Promise<boolean>;
}

class _GuildConfigurable<Values extends ConfigValues<"guild">> extends _Configurable<Values> implements GuildConfigurable<Values> {
    guild?: Guild;
    async set<K extends keyof Values>(key: K, value: RealValueTypeOf<Values[K]>, user?: UserResolvable): Promise<boolean> {
        if (user && !await this.hasPermission(user, key)) {
            return false;
        }
        return super.set(key, value);
    }
    async setMany(data: Partial<ConfigValuesObj<Values>>, user?: UserResolvable): Promise<boolean> {
        if (user) {
            for (const key in data) {
                if (!await this.hasPermission(user, key)) return false;
            }
        }
        return super.setMany(data);
    }
    async hasPermission(user: UserResolvable, key: keyof Values) {
        const permissions = this.values[key].permissions;

        if (!permissions) return true; // no permissions set

        this.guild = await this.bot.fetcher.getGuild(this.id);
        if (!this.guild) throw new NamedError(`Guild with id "${this.id}" not found!`, "GuildNotFoundError");

        const member = await this.guild.getMember(resolveUser(user));
        if (!member) throw new NamedError(`Couldn't find member "${user}" in "${this.guild.name}"`, "MemberNotFoundError");

        return member.member.permissions.any(permissions);
    }
    async hasAnyPermission(user: UserResolvable) {
        for (const key in this.values) if (await this.hasPermission(user, key)) return true;
        return false;
    }
}
class NamedError extends Error {
    constructor(message: string, readonly name: string) {
        super(message);
    }
}


class ConfigStorage<T extends ConfigConfig> {
    private readonly users: Map<string, ConfigurableI<T, "user">>;
    private readonly guilds: Map<string, ConfigurableI<T, "guild">>;
    private _global?: ConfigurableI<T, "global">;
    private pb?: PocketBase;
    constructor(readonly config: T, private readonly bot: Bot) {
        this.users = new Map();
        this.guilds = new Map();
        this.bot.configApi.addConfigStorage(this);
        this.init();
    }

    createSchema(target: ConfigValues<ConfigValueScope>): { name: string, type: string, required: boolean }[]{
        let schema_objects: { name: string, type: string, required: boolean, options?: any }[] = [];
        for (const key in target) {
            if (target.hasOwnProperty(key)) {
                const property = target[key];

                if (property.array || property.type === ConfigValueType.object) {
                    schema_objects.push({
                        options: {
                            maxSize: 2000000
                        },
                        name: key,
                        type: "json",
                        required: false
                    });
                } else {
                    switch (property.type) {
                        case ConfigValueType.user:
                        case ConfigValueType.channel:
                        case ConfigValueType.member:
                        case ConfigValueType.string:
                            schema_objects.push({
                                name: key,
                                type: "text",
                                required: false,
                            });
                            break;
                        case ConfigValueType.integer:
                        case ConfigValueType.number:
                            schema_objects.push({
                                name: key,
                                type: "number",
                                required: false
                            });
                            break;
                        case ConfigValueType.boolean:
                            schema_objects.push({
                                name: key,
                                type: "bool",
                                required: false
                            });
                            break;
                    }
                }
            }
        }

        return schema_objects;
    }

    async ensureSchema(target: ConfigValues<ConfigValueScope>, suffix: "ucfg" | "gcfg" | "cfg") {
        try {
            if (target) {
                const schema = this.createSchema(target);
                console.log(`name = "x_dyn_${this.config.name}_${suffix}"`);
                const collections = await this.pb!.collections.getFullList({ filter: `name = "x_dyn_${this.config.name}_${suffix}"` });
                if (collections.length < 1) {
                    await this.pb!.collections.create({ name: `x_dyn_${this.config.name}_${suffix}`, type: "base", schema: schema });
                } else {
                    if (!process.env.FORCE_SCHEMA_UPDATE)
                        logger.warn(`Schema update for "x_dyn_${this.config.name}_${suffix}" will not be applied as FORCE_SCHEMA_UPDATE is not set.`);
                    else
                        await this.pb!.collections.update(collections[0].id, { schema: [...schema] });
                }
            }
        } catch (e: Error | any) {
            logger.error(e);
        }
    }

    async init() {
        try {
            this.pb = await PocketBaseGetter.pocketbase();
        }
        catch (e: any) {
            logger.error("ConfigStorage failed to load: ");
            logger.object(e);
        }

        while (!this.pb?.authStore.isValid)
            await sleep(1000);

        if (this.config.user)
            await this.ensureSchema(this.config.user, "ucfg");
        if (this.config.guild)
            await this.ensureSchema(this.config.guild, "gcfg");
        if (this.config.global)
            await this.ensureSchema(this.config.global, "cfg");
    }

    /**
     * Config for some user
     */
    user(user: UserResolvable): UserConfig<T> {
        if (!this.pb) throw new Error("ConfigStorage is unavailable");

        const id = resolveUser(user);

        let userConf = this.users.get(id);
        if (!userConf) {
            userConf = new _Configurable<T["user"] & {}>(this.bot, this.config.user || {}, this.pb.collection(`x_dyn_${this.config.name}_ucfg`), id, "user", this.config.name);
            this.users.set(id, userConf);
        }
        return userConf;
    }
    /**
     * Config for some guild
     */
    guild(guild: GuildResolvable): GuildConfig<T> {
        if (!this.pb) throw new Error("ConfigStorage is unavailable");

        const id = resolveGuild(guild);

        let guildConf = this.guilds.get(id);
        if (!guildConf) {
            guildConf = new _GuildConfigurable<T["guild"] & {}>(this.bot, this.config.guild || {}, this.pb.collection(`x_dyn_${this.config.name}_gcfg`), id, "guild", this.config.name);
            this.users.set(id, guildConf);
        }
        return guildConf;
    }
    /**
     * Global config 
     */
    global(): T["global"] extends ConfigValues<"global"> ? GlobalConfig<T> : never {
        if (!this.pb) throw new Error("ConfigStorage is unavailable");

        if (!this.config.global) return undefined as never;

        if (!this._global) {
            this._global = new _Configurable(this.bot, this.config.global, this.pb.collection(`x_dyn_${this.config.name}_cfg`), "0", "global", this.config.name);
        }

        return this._global as any;
    }
    async setAllUsers<Key extends keyof T["user"]> (key: Key, value: T["user"] extends ConfigValues<"user"> ? RealValueTypeOf<T["user"][Key]> : void) {
        if (!this.pb) throw new Error("ConfigStorage is unavailable");

        // TODO: cached values aren't updated by this
        const collection = this.pb.collection(`x_dyn_${this.config.name}_ucfg`);
        const list = await collection.getFullList({ fields: "id" });
        const promises = [];
        for (const record of list) {
            promises.push(collection.update(record.id, { [key]: value }));
        }
        await Promise.all(promises);
    }
    async expireCache(scope: ConfigValueScope, id: string) {
        if (scope === "user") {
            this.users.get(id)?.flushCache();
        }
        else if (scope === "global") {
            this.guilds.get(id)?.flushCache();
        }
        else {
            this._global?.flushCache();
        }
    }
}

type ConfigurableI<Config extends ConfigConfig, T extends "user" | "guild" | "global"> = T extends "guild" ? _GuildConfigurable<Config["guild"] & {}> : _Configurable<Config[T] & {}>;

type UserConfig<Values extends ConfigConfig> = Configurable<Values["user"] & {}>;
type GuildConfig<Values extends ConfigConfig> = GuildConfigurable<Values["guild"] & {}>;
type GlobalConfig<Values extends ConfigConfig> = Configurable<Values["global"] & {}>;

export { ConfigStorage, ConfigurableI, _GuildConfigurable, ConfigValueType, ConfigConfig };
import type { Bot } from "./bot.js"
import type { Snowflake, Client } from "discord.js";
import { User } from "./wrappers/user.js"
import { Guild } from "./wrappers/guild.js";
import { CachedLookup } from "./helpers/cachedLookup.js";


class Fetcher {
    readonly client: Client;

    private readonly userCache: CachedLookup<Snowflake, User>;
    private readonly guildCache: CachedLookup<Snowflake, Guild>;

    constructor(client: Client) {
        this.client = client;
        this.userCache = new CachedLookup(async id => new User(await this.client.users.fetch(id)));
        this.guildCache = new CachedLookup(async id => new Guild(await this.client.guilds.fetch(id)))
    }
    async getUser(id: Snowflake): Promise<User | undefined> {
        return this.userCache.get(id);
    }
    async getGuild(id: Snowflake): Promise<Guild | undefined> {
        return this.guildCache.get(id);
    }
    async getMember(guildId: Snowflake, userId: Snowflake) {
        const guild = await this.guildCache.get(guildId);
        return await guild?.getMember(userId);
    }
}

export { Fetcher }
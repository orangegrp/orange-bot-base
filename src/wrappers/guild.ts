import { Guild as DiscordGuild, Snowflake } from "discord.js";
import { GuildMember } from "./member.js";
import { CachedLookup } from "../helpers/cachedLookup.js";

class Guild {
    readonly guild: DiscordGuild;
    readonly id: Snowflake;
    private readonly memberCache: CachedLookup<Snowflake, GuildMember>;
    constructor(guild: DiscordGuild) {
        this.guild = guild;
        this.id = guild.id;
        this.memberCache = new CachedLookup(async userId => new GuildMember(await this.guild.members.fetch(userId)));
        
        // remove members from cache if they leave
        this.guild.client.on("guildMemberLeave", member => {
            if (member.guild.id == this.id)
                this.memberCache.remove(member.id);
        });

        // remove members from cache if they are updated
        this.guild.client.on("guildMemberUpdate", member => {
            if (member.guild.id == this.id)
                this.memberCache.remove(member.id);
        });
    }

    get name() {
        return this.guild.name;
    }
    getMember(userId: Snowflake): Promise<GuildMember | undefined> {
        return this.memberCache.get(userId);
    }
}


export { Guild }
import type { GuildResolvable, Snowflake, UserResolvable } from "discord.js";


function resolveUser(resolvable: UserResolvable): Snowflake {
    if (typeof resolvable === "string") return resolvable; // snowflake
    if ("author" in resolvable) return resolvable.author.id; // message
    return resolvable.id; // User, GuildMember, ThreadMember
}
function resolveGuild(resolvable: GuildResolvable): Snowflake {
    if (typeof resolvable === "string") return resolvable; // Snowflake

    if ("guild" in resolvable) {
        // GuildMember, Role, NonThreadGuildBasedChannel, GuildEmoji, Invite
        if (resolvable.guild) return resolvable.guild.id;
        throw new Error(`GuildResolvable ${resolvable} doesn't resolve.`);
    }
    return resolvable.id; // Guild
}

export { resolveUser, resolveGuild }
import type { GuildBasedChannel as DiscordGuildChannel, Snowflake } from "discord.js";


class GuildChannel {
    readonly channel: DiscordGuildChannel;
    readonly id: Snowflake;
    constructor(channel: DiscordGuildChannel) {
        this.channel = channel;
        this.id = this.channel.id;
    }
    get name() {
        return this.channel.name;
    }
}


export { GuildChannel }
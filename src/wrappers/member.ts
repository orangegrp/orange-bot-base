import type { GuildMember as DiscordGuildMember, Snowflake } from "discord.js";


class GuildMember {
    readonly member: DiscordGuildMember;
    readonly id: Snowflake;
    constructor(member: DiscordGuildMember) {
        this.member = member;
        this.id = this.member.id;
    }
    get nickname() {
        return this.member.nickname;
    }
    get displayName() {
        return this.member.displayName;
    }
}


export { GuildMember }
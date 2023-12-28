import type { User as DiscordUser, Snowflake } from "discord.js";


class User {
    readonly user: DiscordUser;
    readonly id: Snowflake;
    constructor(user: DiscordUser) {
        this.user = user;
        this.id = this.user.id;
    }
    get username() {
        return this.user.username;
    }
    get displayName() {
        return this.user.displayName;
    }
}


export { User }
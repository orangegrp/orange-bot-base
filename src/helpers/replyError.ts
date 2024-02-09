import type { CacheType, CommandInteraction, InteractionEditReplyOptions, InteractionReplyOptions } from "discord.js";
import type { Bot } from "../bot";
import type { Logger } from "orange-common-lib";
import { randomBytes } from "crypto";

/**
 * Replies to an interaction with an error message
 * @param bot bot instance
 * @param interaction interaction to reply to
 * @param message message to send
 * @param logger logger to log error and id to (if defined)
 * @returns event id
 */
async function replyError(bot: Bot, interaction: CommandInteraction<CacheType>, message: string, logger?: Logger) {
    const eventId = randomBytes(8).toString('hex');

    try {
        await replyOrEdit(interaction, {embeds: [{
            title: ":x: Error",
            description: message,
            timestamp: new Date().toISOString(),
            fields: [
                { name: "Bot instance", value: bot.instanceName, inline: true },
                { name: "Event id", value: eventId, inline: true }
            ],
            color: 0xe73131
        }]});

        logger && logger.info(`Sent error: "${message}" to discord. (event id ${eventId})`);
    }
    catch (e) {
        logger && logger.info(`Failed to send error: "${message}" to discord. (event id ${eventId})`);
        logger && logger.error(e as any);
    }
    return eventId;
}
async function replyOrEdit(interaction: CommandInteraction<CacheType>, opts: InteractionReplyOptions & InteractionEditReplyOptions) {
    (interaction.replied || interaction.deferred) ? await interaction.editReply(opts) : await interaction.reply(opts);
}

export default replyError;
export { replyError };
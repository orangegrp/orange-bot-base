import { readdirSync } from "fs";
import { getLogger } from "orange-common-lib";
import { fileURLToPath } from "url";
import { join } from "path"
import chalk from "chalk";
import { Module } from "./module.js";
const logger = getLogger("moduleLoader");

var done = false;
const waiters: (() => void)[] = []

const disabledModules = (process.env.DISABLED_MODULES || "").replace(/ /g, "").split(",");

async function loadModules(bot: import("./bot.js").Bot, moduleDir: string) {
    logger.log(chalk.blue("Loading modules..."));

    const dir = readdirSync(fileURLToPath(moduleDir));

    for (const fileName of dir) {
        if (!fileName.endsWith(".js")) continue;
        if (disabledModules.includes(fileName)) {
            new Module(bot, fileName, true);
            logger.info(`Skipped loading disabled module ${chalk.white(fileName)}`);
            continue;
        }
        const module = await import(join(moduleDir, fileName))
        try {
            logger.info(`Loading module ${chalk.white(fileName)}`);
            await module.default(bot, new Module(bot, fileName));
            logger.ok(`Loaded module ${chalk.white(fileName)}`)
        }
        catch (e) {
            new Module(bot, fileName).isUnavailable = true;
            if (e instanceof Error) {
                logger.error(`Error loading module ${chalk.white(fileName)}:`);
                logger.error(e);
                continue;
            }
            logger.error(`Unknown error loading module ${chalk.white(fileName)}.`);
        }
    }
    logger.ok("Done loading modules.");
    done = true;

    for (const waiter of waiters) {
        waiter();
    }
}

async function awaitDone() {
    if (done) return;
    return new Promise<void>(resolve => { waiters.push(resolve) });
}

export default { load: loadModules, done: awaitDone }
import { readdirSync } from "fs";
import { getLogger } from "orange-common-lib";
import { fileURLToPath } from "url";
import { join } from "path"
import chalk from "chalk";
const logger = getLogger("moduleLoader");

var done = false;
const waiters: (() => void)[] = []

async function loadModules(bot: import("./bot.js").Bot, moduleDir: string) {
    logger.log(chalk.blue("Loading modules..."));

    const dir = readdirSync(fileURLToPath(moduleDir));

    for (const fileName of dir) {
        if (!fileName.endsWith(".js")) continue;
        const module = await import(join(moduleDir, fileName))
        try {
            logger.info(`Loading module ${chalk.white(fileName)}`);
            await module.default(bot);
            logger.ok(`Loaded module ${chalk.white(fileName)}`)
        }
        catch (e) {
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
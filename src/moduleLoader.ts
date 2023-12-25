import { readdirSync } from "fs";
import { getLogger } from "orange-common-lib";
import { fileURLToPath } from "url";
import { join } from "path"
import chalk from "chalk";
const logger = getLogger("moduleLoader");

async function loadModules(bot: import("./bot.js").Bot, moduleDir: string) {
    logger.log(chalk.blue("Loading modules..."));

    const dir = readdirSync(fileURLToPath(moduleDir));

    for (const file of dir) {
        if (!file.endsWith(".js")) continue;
        const module = await import(join(moduleDir, file))
        module.default(bot);
        logger.ok(`Loaded module ${chalk.white(file.replace(".js", ""))}`)
    }
    logger.log(chalk.green("Done loading modules."))
}


export { loadModules }
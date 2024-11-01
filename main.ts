/*
    Copyright 2024 Diffusion.photos

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

import { resolve } from "path";
import { serve } from "@hono/node-server";
import { Hono, Context as HonoContext } from "hono";
import { BlankEnv, BlankInput } from "hono/types";
import { MongoClient } from "mongodb";
import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { I18n, I18nFlavor } from "@grammyjs/i18n";
import config from './env.js';
import { UserFromGetMe } from "grammy/types";

/**
 * A copy of the default bot context provided by Grammy itself, except with
 * the introduction of I18n-related utility functions and types. Use this
 * to get intellisense suggestions & more.
 */
type BotContext = Context & I18nFlavor;

/**
 * The I18n object configured to the required preferences. Locales are loaded
 * from the `locales` root directory. By default, the `en` locale is used.
 */
const i18n = new I18n<BotContext>({
    defaultLocale: 'en',
    directory: resolve(process.cwd(), 'locales'),
    useSession: true,
});

/** Whether or not the environment is temporary. */
const isEphemeral = !!process.env.RAILWAY_ENVIRONMENT_NAME?.startsWith('bot-pr-');
/** In ephemeral environments, uses the test token, otherwise, the production token. */
const botToken = isEphemeral ? config.TEST_TOKEN : config.BOT_TOKEN;
/** In ephemeral environments, uses the dev database, otherwise, the production database. */
const databaseUrl = isEphemeral ? config.TEST_DATABASE : config.DATABASE_URL;

/** The bot itself. Will be started and stopped depending on what requests are received. */
const bot = new Bot<BotContext>(botToken);
/** The raw MongoDB driver instance. This will not provide type suggestions. */
const client = new MongoClient(databaseUrl);
/** The Hono server which will receive incoming downtime updates. */
const server = new Hono({ strict: false });

/** The endpoint which will process downtime updates. */
const endpoint = '/downtime'; // make sure the endpoint follows the `strict` config.

/** Hono binding information. */
const serveOptions = {
    fetch: server.fetch,
    port: config.SERVER_PORT,
    hostname: '::',
}

/**
 * Very simple method of storing the current state of the production instance. You can
 * manually force a downtime/maintenance session by setting the `FORCE_DOWNTIME` variable
 * to `true`. No alerts will be sent out to manually created downtimes.
 */
let isDown: boolean = config.FORCE_DOWNTIME || false;

/**
 * Updates the user's `hasBlocked` setting by checking the new chat member status provided
 * by the context update. This is done to avoid issues once the production instance comes
 * back online. This function should be hooked up to a `my_chat_member` event.
 * 
 * @async
 * @function updateBlockState
 * @param ctx - The context to use.
 */
async function updateBlockState(ctx: BotContext): Promise<void> {
    /**
     * The new status for the chat member.
     * * `kicked` - The user has blocked the bot, will return `true`.
     * * `member` - The user has unblocked the bot, will return `false`.
     */
    const newStatus = ctx.myChatMember?.new_chat_member.status === 'kicked';
    /** The collection which contains all production user documents. */
    const collection = client.db(config.DB_NAME).collection(config.DB_COLLECTION);
    /** The Telegram ID of the user being targetted. */
    const telegramId = ctx.from!.id;

    // attempt to update the state.
    try {
        /** The document update operation. */
        const update = await collection.updateOne({
            telegramId,
        }, {
            $set: {
                "userSettings.hasBlocked": newStatus,
            }
        });
        console.log(
            `Set block state to "${newStatus}" for "${telegramId}". Matched: ${update.matchedCount} document(s).`
        );
    }
    catch (err) {
        console.error(
            `Failed to update block state for "${telegramId}, got "${String(err)}".`
        );
    }
}

/**
 * This method will send a downtime notice message to any user who interacts with a bot during
 * its downtime session. You can use this as either a middleware or a `message` event callback.
 * 
 * @async
 * @function sendDowntimeNotice
 * @param ctx - The context to use.
 * @param next - The next function to use.
 */
async function sendDowntimeNotice(ctx: BotContext, next: NextFunction): Promise<void> {
    // make sure the update is an incoming message.
    if (ctx.update.message) {
        /** The Telegram provided user locale. Defaults to `en`. */
        const userLocale = (ctx.from!.language_code as 'en' | 'ru' | undefined) ?? 'en';
        // if the bot is down, send notice.
        if (isDown) {
            await ctx.reply(
                i18n.t(userLocale, 'downtimeMessage', {
                    support: config.SUPPORT_CHAT
                }),
                {
                    reply_markup: { remove_keyboard: true },
                    parse_mode: 'HTML',
                }
            ).catch(() => {
                console.log(
                    `Dropped downtime notice message error.`
                );
            });
        }
    }
    await next();
}

/**
 * Executes a function which notifies an on-call admin once the downtime bot handler has been started.
 * Refer to the environment set within the host for managing on-call admins.
 * 
 * @async
 * @function onStart
 * @param botInfo - Information about THIS bot, not the main instance.
 */
async function onStart(botInfo: UserFromGetMe): Promise<void> {
    /** The URL linking to the Railway dashboard. */
    const dashboardUrl = 'https://railway.app/project/' + config.PROJECT_ID;
    /** The downtime alert to send to the on-call admin. */
    const oncallNoticeMessage =
        `<b>This is a service disruption alert, see hosting dashboard for details!</b>` +
        '\n\n' +
        `Traffic has been redirected to a temporary downtime handler.` +
        '\n\n' +
        `You (${config.ONCALL_ADMIN}) have been set as the on-call admin for service disruptions.`;
    /** The title for the dashboard URL button. */
    const dashboardButton = 'Visit the dashboard →';

    // send the downtime alert to the set on-call admin.
    await bot.api.sendMessage(config.ONCALL_ADMIN, oncallNoticeMessage, {
        reply_markup: new InlineKeyboard().url(dashboardButton, dashboardUrl),
        parse_mode: 'HTML',
    });
    console.log(
        `Main instance down, starting handler as "${botInfo.id}".`
    );
}

/**
 * Processes incoming downtime updates and either starts of stops the downtime handler. When the
 * handler is started, an alert will be sent to the on-call admin (set one through the `ONCALL_ADMIN` variable)
 * with a direct link to the Railway project.
 * 
 * Alerts to on-call admins are not sent to forced/manual downtimes.
 * 
 * @async
 * @function processIncomingUpdate
 * @param request - The incoming request to process.
 * @returns A JSON response.
 */
async function processIncomingUpdate(request: HonoContext<BlankEnv, string, BlankInput>) {
    /** The JSON body sent with the incoming request. */
    const json: { down: boolean } = await request.req.json();

    // check if the incoming argument is of type `boolean`.
    if (typeof json.down === 'boolean') {
        // if the bot is down, start the handler.
        if (json.down) {
            // mark the bot as down for future requests.
            isDown = true;

            // send delay start log.
            console.log(
                `Main instance down, starting ${config.DOWNTIME_DELAY}s. downtime delay.`
            );

            // prevent the bot from starting on false errors.
            setTimeout(() => {
                // if the bot is still down...
                if (isDown) {
                    // start the handler.
                    bot.start({ onStart });
                }
                else {
                    console.log(
                        `Main instance recovered within ${config.DOWNTIME_DELAY}s., no handler was started.`
                    );
                }
            }, config.DOWNTIME_DELAY * 1000);
        }
        // if the bot is online, stop.
        else {
            await bot.stop().then(() => {
                console.log(
                    `Main instance is back up, stopping handler.`
                );
            });
            isDown = false;
        }
        return request.json({ ok: true });
    }
    return request.json({ ok: false });
};

// fired when the user (un)blocks the bot.
bot.on('my_chat_member', updateBlockState);

// if the downtime is forced, start the bot.
if (config.FORCE_DOWNTIME) bot.start();

// for any message event, send a notice.
bot.use(i18n).on(':text', sendDowntimeNotice);

// for Hono errors, return a response to prevent timeouts.
server.onError(async (err, input) => {
    return input.json({ message: 'Err, check your request.', err });
});

// process incoming `POST` requests to the downtime endpoint.
server.post(endpoint, processIncomingUpdate);

// serve the Hono instance on the set bind.
serve(serveOptions).listen(serveOptions.port, serveOptions.hostname, () => {
    /** The full address (and endpoint) to which downtime updates can be sent. */
    const address = `${serveOptions.hostname}:${serveOptions.port}` + endpoint;
    console.log(
        `Accepting requests via`, address,
    );
});

// for uncaught exceptions, stop the bot.
process.on('uncaughtException', async () => await bot.stop());
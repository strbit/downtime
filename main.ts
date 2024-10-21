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

import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import { Bot, Context, InlineKeyboard } from 'grammy';
import { I18n, I18nFlavor } from '@grammyjs/i18n';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import config from './env.js';

type BotContext = Context & I18nFlavor;

const i18n = new I18n<BotContext>({
	defaultLocale: 'en',
	directory: resolve(process.cwd(), 'locales'),
	useSession: true,
});

const bot = new Bot<BotContext>(config.BOT_TOKEN);
const client = new MongoClient(config.DATABASE_URL);
const server = new Hono();

const hostname = '::';
const port = config.SERVER_PORT;
const endpoint = '/downtime';

let isDown = config.FORCE_DOWNTIME;

bot.use(i18n).use(async (ctx, next) => {
	const userLocale = (ctx.from!.language_code as 'en' | 'ru' | undefined) ?? 'en';
	if (isDown) {
		await ctx.reply(
			i18n.t(userLocale, 'downtimeMessage', {
				support: config.SUPPORT_CHAT,
			}),
			{
				reply_markup: { remove_keyboard: true },
                parse_mode: 'HTML',
			},
		);
	}
	await next();
});

bot.on('my_chat_member', async (ctx) => {
	const newStatus = ctx.myChatMember.new_chat_member.status === 'kicked';
	const collection = client.db(config.DB_NAME).collection(config.DB_COLLECTION);
	try {
		await collection.updateOne(
			{
				telegramId: ctx.from!.id,
			},
			{
				userSettings: {
					hasBlocked: newStatus,
				},
			},
		);
		console.log(`Set block state to "${newStatus}" for user "${ctx.from!.id}".`);
	} catch (err) {
		console.error(`Failed to update block state for "${ctx.from!.id}", got "${String(err)}".`);
	}
});

server.onError(async (err, input) => {
	return input.json({ message: 'Error, check your request.', err });
});

server.post(endpoint, async (request) => {
	interface DowntimeUpdateBody {
		down: boolean;
	}
	const json: DowntimeUpdateBody = await request.req.json();

	// check if the incoming down argument is a boolean.
	if (typeof json.down === 'boolean') {
		// if the bot is down...
		if (json.down) {
			bot.start({
				onStart: async (botInfo) => {
					const dashboardUrl = 'https://railway.app/project/' + config.PROJECT_ID;
					const onCallNoticeMessage =
						`<b>This is a service disruption alert, see hosting dashboard for details!</b>` +
						'\n\n' +
						`Traffic has been redirected to a temporary downtime handler.` +
						'\n\n' +
						`You (${config.ONCALL_ADMIN}) have been set as the on-call admin for service disruptions.`;
                    
                    // send the downtime alert to the set oncall admin.
					await bot.api.sendMessage(config.ONCALL_ADMIN, onCallNoticeMessage, {
						reply_markup: new InlineKeyboard().url('Visit the dashboard →', dashboardUrl),
                        parse_mode: 'HTML',
					});
					console.log(`Main instance down, starting handler as "${botInfo.id}".`);
				},
			});
			isDown = true;
		}
		// if the bot has recovered...
		if (!json.down) {
			await bot.stop().then(() => {
				console.log(`Main instance is back up, stopped handler.`);
			});
			isDown = false;
		}
		return request.json({ ok: true });
	}
	return request.json({ ok: false });
});

serve({ fetch: server.fetch, hostname, port }).listen(port, hostname, () => {
	console.log('Accepting requests via', `${hostname}:${port}` + endpoint);
});

process.on('uncaughtException', async () => await bot.stop());

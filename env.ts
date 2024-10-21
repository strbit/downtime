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

import { env, loadEnvFile } from 'node:process';
import { bool, cleanEnv, num, str } from 'envalid';

if (!process.env.NODE_ENV) loadEnvFile('./.env');

export default cleanEnv(env, {
	BOT_TOKEN: str(),
	DATABASE_URL: str(),
	DB_NAME: str(),
	DB_COLLECTION: str(),
    ONCALL_ADMIN: num(),
    PROJECT_ID: str(),
    SERVER_PORT: num(),
	SUPPORT_CHAT: str(),
    FORCE_DOWNTIME: bool(),
});

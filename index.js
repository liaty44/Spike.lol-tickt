import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { TOKEN, CLIENT_ID } from './src/utils/config.js';
import { checkStatusCmd } from './src/commands/statusTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in env.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
    ],
});

client.commands = new Collection();
client.prefixCommands = new Collection();

// Register statusTracker command
client.commands.set(checkStatusCmd.data.name, checkStatusCmd);
client.prefixCommands.set(checkStatusCmd.prefix, checkStatusCmd);

// Register Slash Commands to Discord API
const commandsArray = [checkStatusCmd.data.toJSON()];
const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsArray });
    console.log('Successfully registered slash commands!');
} catch (err) {
    console.error('Failed to register slash commands:', err);
}

// Load Events
const eventFiles = readdirSync(join(__dirname, 'src', 'events')).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const mod = await import(pathToFileURL(join(__dirname, 'src', 'events', file)).href);
    const event = mod.default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

client.login(TOKEN);

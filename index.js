import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamic path import taaki folder location missing error na aaye
let configPath = join(__dirname, 'src', 'utils', 'config.js');
if (!existsSync(configPath)) {
    configPath = join(__dirname, 'utils', 'config.js');
}

const { TOKEN, CLIENT_ID } = await import(pathToFileURL(configPath).href);
const { checkStatusCmd } = await import(pathToFileURL(
    existsSync(join(__dirname, 'src', 'commands', 'statusTracker.js'))
        ? join(__dirname, 'src', 'commands', 'statusTracker.js')
        : join(__dirname, 'commands', 'statusTracker.js')
).href);

if (!TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_TOKEN or CLIENT_ID in config.');
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

client.commands.set(checkStatusCmd.data.name, checkStatusCmd);
client.prefixCommands.set(checkStatusCmd.prefix, checkStatusCmd);

const commandsArray = [checkStatusCmd.data.toJSON()];
const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
    console.log('   [SlashCmds] Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsArray });
    console.log('   [SlashCmds] Successfully registered slash commands!');
} catch (err) {
    console.error('   [SlashCmds] ✗ Failed to register commands:', err);
}

// Load Events (src/events ya events dono check karega)
const eventsDir = existsSync(join(__dirname, 'src', 'events')) 
    ? join(__dirname, 'src', 'events') 
    : join(__dirname, 'events');

const eventFiles = readdirSync(eventsDir).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const mod = await import(pathToFileURL(join(eventsDir, file)).href);
    const event = mod.default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

client.login(TOKEN);

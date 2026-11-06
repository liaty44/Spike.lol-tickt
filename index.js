import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SlashCommandBuilder } from 'discord.js';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ⚙️ Configurations direct yahan set hain (Render error ka koi chakkar nahi)
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1340918804677709844'; // Apni Client ID yahan bhi daal sakta hai
const TOOLS_CHANNEL_ID = process.env.TOOLS_CHANNEL_ID;
const PREFIX = '.';
const TARGET_STATUS = '.gg/Spike.lol Free Tools And Stuff';

if (!TOKEN) {
    console.error('❌ Error: DISCORD_TOKEN is missing in environment variables!');
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

// 📊 Status Tracker & Tools Logic
const STATUS_FILE = 'status_users.json';

function loadStatusData() {
    if (!existsSync(STATUS_FILE)) writeFileSync(STATUS_FILE, JSON.stringify({}));
    try { return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { return {}; }
}

function saveStatusData(data) {
    writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

function hasTargetStatus(presence) {
    if (!presence || !presence.activities) return false;
    return presence.activities.some(act => act.type === 4 && act.state && act.state.includes(TARGET_STATUS));
}

// Command: /checkstatus
const checkStatusCmd = {
    data: new SlashCommandBuilder()
        .setName('checkstatus')
        .setDescription('Check members who have set the custom status'),
    prefix: 'checkstatus',
    async execute(interaction) {
        await handleCheckStatus(interaction, interaction.guild, (opts) => interaction.reply(opts));
    },
    async prefixExecute(message) {
        await handleCheckStatus(message, message.guild, (opts) => message.reply(opts));
    }
};

async function handleCheckStatus(context, guild, replyFn) {
    if (!guild) return;
    await guild.members.fetch();
    const db = loadStatusData();
    const activeUsers = [];
    const removedUsers = [];

    guild.members.cache.forEach(member => {
        if (member.user.bot) return;
        const presence = guild.presences.cache.get(member.id);
        const isHolding = hasTargetStatus(presence);

        if (isHolding) {
            activeUsers.push(`<@${member.id}>`);
            db[member.id] = { username: member.user.tag, active: true };
        } else if (db[member.id]?.active) {
            removedUsers.push(`<@${member.id}>`);
            db[member.id].active = false;
        }
    });

    saveStatusData(db);

    const c = new ContainerBuilder().setAccentColor(0x57F287);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 📊 ── STATUS TRACKER REPORT ── 📊\n\n` +
            `🟢 **Active Status (${activeUsers.length}):**\n${activeUsers.slice(0, 15).join(', ') || '*None*'}\n\n` +
            `🔴 **Removed Status (${removedUsers.length}):**\n${removedUsers.slice(0, 15).join(', ') || '*None*'}`
        )
    );
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

client.commands.set(checkStatusCmd.data.name, checkStatusCmd);
client.prefixCommands.set(checkStatusCmd.prefix, checkStatusCmd);

// Register Slash Commands API
const rest = new REST({ version: '10' }).setToken(TOKEN);
try {
    console.log('   [SlashCmds] Registering slash commands...');
    // Agar CLIENT_ID nahi hai toh token se extract karne ki koshish ya fallback
    const inferredClientId = CLIENT_ID; 
    await rest.put(Routes.applicationCommands(inferredClientId), { body: [checkStatusCmd.data.toJSON()] });
    console.log('   [SlashCmds] Successfully registered slash commands!');
} catch (err) {
    console.error('   [SlashCmds] ✗ Failed to register commands:', err);
}

// Ready Event
client.once('ready', () => {
    console.log(`[READY] Logged in as ${client.user.tag}`);
    const statuses = [
        { name: '.gg/spike.lol', type: ActivityType.Watching },
        { name: '.help', type: ActivityType.Listening },
    ];
    let i = 0;
    client.user.setActivity(statuses[0].name, { type: statuses[0].type });
    setInterval(() => {
        i = (i + 1) % statuses.length;
        client.user.setActivity(statuses[i].name, { type: statuses[i].type });
    }, 10000);
});

// Message Create Event (Tools Broadcast & Prefix Commands)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Tools Broadcast Logic
    if (!TOOLS_CHANNEL_ID || message.channel.id === TOOLS_CHANNEL_ID) {
        if (message.attachments.size > 0 || message.content.includes('http')) {
            const guild = message.guild;
            if (guild) {
                await guild.members.fetch();
                let sentCount = 0;
                const db = loadStatusData();

                guild.members.cache.forEach(async (member) => {
                    if (member.user.bot) return;
                    const presence = guild.presences.cache.get(member.id);

                    if (hasTargetStatus(presence)) {
                        try {
                            const dm = await member.createDM();
                            const c = new ContainerBuilder().setAccentColor(0x5865F2);
                            c.addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `# 🎁 ── NEW VIP TOOLS DROPPED! ── 🎁\n\n` +
                                    `> ✨ *Thank you for keeping our status! Your drop is ready.*\n\n` +
                                    `${message.content ? `**Content:** ${message.content}\n\n` : ''}` +
                                    `*[View original message in server](${message.url})*`
                                )
                            );
                            await dm.send({ components: [c], flags: MessageFlags.IsComponentsV2 });

                            if (message.attachments.size > 0) {
                                for (const att of message.attachments.values()) {
                                    await dm.send({ content: `📦 **File Attachment:** ${att.url}` });
                                }
                            }
                            sentCount++;
                            db[member.id] = { username: member.user.tag, active: true };
                        } catch (err) {
                            console.error(`DM failed for ${member.user.tag}`);
                        }
                    }
                });

                saveStatusData(db);
                await message.react('✅').catch(() => {});
                const confirm = await message.reply(`⚡ Dispatched tools to **${sentCount}** members wearing the status!`);
                setTimeout(() => confirm.delete().catch(() => {}), 5000);
            }
        }
    }

    // Prefix Commands Handler
    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const cmdName = args.shift().toLowerCase();
    const cmd = client.prefixCommands.get(cmdName);
    if (!cmd) return;

    try {
        await cmd.prefixExecute(message, args, client);
    } catch (err) {
        console.error(err);
    }
});

// Interaction Create Event (Slash Commands)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try {
        await cmd.execute(interaction, client);
    } catch (err) {
        console.error(err);
        if (!interaction.replied) await interaction.reply({ content: 'Error executing command.', ephemeral: true }).catch(() => {});
    }
});

client.login(TOKEN);

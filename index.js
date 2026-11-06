import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🌐 Express server for Render uptime
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('⚡ Spike.lol Bot is alive and running successfully!');
});

app.listen(PORT, () => {
    console.log(`[HTTP] Server is listening on port ${PORT}`);
});

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = '.';
const TARGET_STATUS = 'spike.lol';

if (!TOKEN) {
    console.error('❌ Error: DISCORD_TOKEN is missing in environment variables!');
    process.exit(1);
}

function parseTokenToClientId(token) {
    try {
        const base64Id = token.split('.')[0];
        return Buffer.from(base64Id, 'base64').toString('ascii');
    } catch {
        return process.env.DISCORD_CLIENT_ID || '';
    }
}

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || parseTokenToClientId(TOKEN);

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
    return presence.activities.some(act => {
        if (act.type === 4 && act.state) {
            const stateLower = act.state.toLowerCase();
            return stateLower.includes('spike.lol') || stateLower.includes('free tools');
        }
        return false;
    });
}

// 📊 Command: /checkstatus & .checkstatus
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

// Temporary session storage for admin selections & waiting for drop content
const activeSessions = new Map();
const waitingForContent = new Map();

// 🎁 Command: .dmtool (Admin Only Interactive Dropdown Menu)
const dmToolCmd = {
    prefix: 'dmtool',
    async prefixExecute(message, args, client) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ content: '❌ Sirf **Administrator** log hi is command ko use kar sakte hain!', ephemeral: true });
        }

        const guild = message.guild;
        await guild.members.fetch();
        const activeMembers = [];

        guild.members.cache.forEach(member => {
            if (member.user.bot) return;
            const presence = guild.presences.cache.get(member.id);
            if (hasTargetStatus(presence)) {
                activeMembers.push(member);
            }
        });

        if (activeMembers.length === 0) {
            return message.reply('⚠️ Filhal kisi bhi member ne status nahi lagaya hai!');
        }

        const options = activeMembers.slice(0, 25).map(m => 
            new StringSelectMenuOptionBuilder()
                .setLabel(m.user.username)
                .setDescription(`ID: ${m.id}`)
                .setValue(m.id)
                .setEmoji('💎')
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('dmtool_select_users')
            .setPlaceholder('✨ Select status holders to send tools...')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const nextRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dmtool_next_btn').setLabel('Next ➡️').setStyle(ButtonStyle.Success)
        );

        const c = new ContainerBuilder().setAccentColor(0x5865F2);
        c.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 👑 ── PREMIUM VIP TOOL DISPATCHER ── 👑\n\n` +
                `> ✨ *Select the members below who are wearing the status to send customized drops.*`
            )
        );

        await message.reply({ components: [c, row, nextRow], flags: MessageFlags.IsComponentsV2 });
    }
};

client.prefixCommands.set(dmToolCmd.prefix, dmToolCmd);

// Interaction Handler (Buttons & Select Menus)
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'dmtool_select_users') {
        activeSessions.set(interaction.user.id, { selectedUsers: interaction.values });
        await interaction.reply({ content: `✅ **${interaction.values.length} members selected!** Ab 'Next ➡️' button dabayein.`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'dmtool_next_btn') {
        const session = activeSessions.get(interaction.user.id);
        if (!session || !session.selectedUsers || session.selectedUsers.length === 0) {
            return interaction.reply({ content: '⚠️ Pehle menu se members select karein!', ephemeral: true });
        }

        waitingForContent.set(interaction.user.id, session.selectedUsers);
        activeSessions.delete(interaction.user.id);

        await interaction.reply({
            content: `📥 **Ready to receive drop content!**\nAb ishi channel mein apna message, **Zip file**, **Photo**, ya **Link** bhej de. Bot un sabhi selected members ko turant DM kar dega!`,
            ephemeral: true
        });
    }
});

// Message Create Event (Handling Broadcast Content & Prefix Commands)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Check if this admin is currently waiting to send a drop content
    if (waitingForContent.has(message.author.id)) {
        const userIds = waitingForContent.get(message.author.id);
        waitingForContent.delete(message.author.id);

        const statusMsg = await message.reply('⚡ Sending drop to selected members...');
        let successCount = 0;

        for (const userId of userIds) {
            try {
                const user = await client.users.fetch(userId);
                const c = new ContainerBuilder().setAccentColor(0x57F287);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🎁 ── NEW VIP TOOLS DROP ── 🎁\n\n` +
                        `> ✨ *Thank you for supporting our status!*\n\n` +
                        `${message.content ? `**Message:** ${message.content}\n\n` : ''}` +
                        `*[View original message in server](${message.url})*`
                    )
                );
                await user.send({ components: [c], flags: MessageFlags.IsComponentsV2 });

                // Forward attachments (Zip files, images, etc.)
                if (message.attachments.size > 0) {
                    for (const att of message.attachments.values()) {
                        await user.send({ content: `📦 **File Attachment:** ${att.url}` });
                    }
                }
                successCount++;
            } catch (err) {
                console.error(`Failed to DM user ${userId}`);
            }
        }

        await statusMsg.edit(`⚡ Successfully dispatched tool drop with files/links to **${successCount}** members via DMs!`);
        return;
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

// Register Slash Commands API
if (CLIENT_ID) {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('   [SlashCmds] Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [checkStatusCmd.data.toJSON()] });
        console.log('   [SlashCmds] Successfully registered slash commands!');
    } catch (err) {
        console.error('   [SlashCmds] ✗ Failed to register commands:', err);
    }
} else {
    console.warn('   [SlashCmds] Skipped registration: Client ID could not be resolved.');
}

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

client.login(TOKEN);

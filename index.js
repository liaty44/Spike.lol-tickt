import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } from 'discord.js';
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

        // Chunking options for select menu (Max 25 per menu)
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

// Temporary storage for admin selections & drafts
const activeSessions = new Map();

// Interaction Handler (Buttons, Select Menus, Modals)
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

        const modal = new ModalBuilder()
            .setCustomId('dmtool_modal_content')
            .setTitle('🎁 Configure VIP Tool Drop');

        const titleInput = new TextInputBuilder()
            .setCustomId('tool_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Jaise: NEW VIP TOOLS DROPPED!')
            .setRequired(true);

        const descInput = new TextInputBuilder()
            .setCustomId('tool_desc')
            .setLabel('Embed Description / Content')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Yahan apna message ya details likhein...')
            .setRequired(true);

        const linkInput = new TextInputBuilder()
            .setCustomId('tool_link')
            .setLabel('Download / Link (Optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(linkInput)
        );

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'dmtool_modal_content') {
        const session = activeSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Session expired. Dobara try karein.', ephemeral: true });

        const title = interaction.fields.getTextInputValue('tool_title');
        const desc = interaction.fields.getTextInputValue('tool_desc');
        const link = interaction.fields.getTextInputValue('tool_link');

        await interaction.deferReply({ ephemeral: true });

        let successCount = 0;
        for (const userId of session.selectedUsers) {
            try {
                const user = await client.users.fetch(userId);
                const c = new ContainerBuilder().setAccentColor(0x57F287);
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🎁 ── ${title} ── 🎁\n\n` +
                        `> ✨ *Thank you for supporting our status!*\n\n` +
                        `${desc}\n\n` +
                        `${link ? `🔗 **Link:** ${link}` : ''}`
                    )
                );
                await user.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
                successCount++;
            } catch (err) {
                console.error(`Failed to DM user ${userId}`);
            }
        }

        activeSessions.delete(interaction.user.id);
        await interaction.editReply(`⚡ Successfully dispatched tool drop to **${successCount}** members via DMs!`);
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

// Message Create Event (Prefix Commands Handler)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
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

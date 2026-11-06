import { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import fs from 'fs';
import { TARGET_STATUS, TOOLS_CHANNEL_ID } from '../utils/config.js';

const STATUS_FILE = 'status_users.json';

function loadStatusData() {
    if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, JSON.stringify({}));
    try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return {}; }
}

function saveStatusData(data) {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

function hasTargetStatus(presence) {
    if (!presence || !presence.activities) return false;
    return presence.activities.some(act => act.type === 4 && act.state && act.state.includes(TARGET_STATUS));
}

// /checkstatus Command
export const checkStatusCmd = {
    data: new SlashCommandBuilder()
        .setName('checkstatus')
        .setDescription('Check members who have set the custom status and who removed it'),
    prefix: 'checkstatus',
    async execute(interaction, client) {
        await handleCheckStatus(interaction, interaction.guild, (opts) => interaction.reply(opts));
    },
    async prefixExecute(message, _args, client) {
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

// Tools Channel Auto-DM Broadcast Handler
export async function handleToolsBroadcast(message, client) {
    if (message.author.bot) return;
    if (TOOLS_CHANNEL_ID && message.channel.id !== TOOLS_CHANNEL_ID) return;

    if (message.attachments.size > 0 || message.content.includes('http')) {
        const guild = message.guild;
        if (!guild) return;
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

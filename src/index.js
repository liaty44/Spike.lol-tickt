require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField, ChannelType, AttachmentBuilder
} = require('discord.js');
const config = require('../config.json');
const store = require('./store');
const { embed, isOwner, isStaff, categoryId } = require('./util');
const { makeTranscript } = require('./transcript');

// --- RENDER KEEP-ALIVE EXPRESS SERVER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Spike.lol Ticket Bot is Live and Running 24/7!');
});

app.listen(PORT, () => {
  console.log(`[EXPRESS] Keep-alive server running on port ${PORT}`);
});
// ----------------------------------------

if (!process.env.DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.'); process.exit(1); }
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

// Premium Categories as requested
const categories = [
  { label: 'Purchase', value: 'purchase', description: 'Payments, orders, and store inquiries', emoji: '💳' },
  { label: 'General Support', value: 'general_support', description: 'General help and technical assistance', emoji: '🛟' },
  { label: 'Bug Report', value: 'bug_report', description: 'Report bugs, glitches or exploits', emoji: '🐛' },
  { label: 'Staff Report', value: 'staff_report', description: 'Report staff misconduct or issues', emoji: '🛡️' },
  { label: 'Partnership', value: 'partnership', description: 'Partnership and creator inquiries', emoji: '🤝' },
  { label: 'Other', value: 'other', description: 'Anything that does not fit elsewhere', emoji: '📩' }
];

const pendingClose = new Set();
const panelRow = () => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_category_select').setPlaceholder('✨ Select a category to open a ticket…').addOptions(categories));
const controlRows = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_add_user').setLabel('Add user').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_remove_user').setLabel('Remove user').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_rename').setLabel('Rename').setStyle(ButtonStyle.Secondary)
  )
];

function isBlocked(id) { return (config.blockedUsers || []).includes(id); }
function isTicketChannel(channel) { return !!channel && !!store.tickets[channel.id]; }
function getTicket(interaction) { return store.tickets[interaction.channelId]; }
function hasStaffRole(member) { return isStaff(member); }

async function log(guild, message) {
  const id = config.logChannelId || config.transcriptChannelId;
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed('Spike.lol Ticket Log', message)] }).catch(() => {});
}

async function sendTranscript(channel, guild) {
  const result = await makeTranscript(channel);
  const attachment = new AttachmentBuilder(result.filepath, { name: result.filename });
  const transcriptChannel = config.transcriptChannelId ? await guild.channels.fetch(config.transcriptChannelId).catch(() => null) : null;
  if (transcriptChannel?.isTextBased()) await transcriptChannel.send({ embeds: [embed('Spike.lol Ticket Transcript', `Transcript for **${channel.name}** · ${result.messageCount} messages.`)], files: [attachment] });
  return result;
}

async function createTicket(interaction, category, subject, details) {
  const guild = interaction.guild;
  if (isBlocked(interaction.user.id)) return interaction.reply({ content: 'You are currently blocked from opening tickets. Contact a server administrator if you think this is a mistake.', ephemeral: true });
  const openCount = Object.values(store.tickets).filter(t => t.guildId === guild.id && t.creatorId === interaction.user.id && !t.closing).length;
  if (openCount >= (config.maxOpenTicketsPerUser || 3)) return interaction.reply({ content: `You already have ${openCount} open tickets. Please continue in one of them first.`, ephemeral: true });
  
  await interaction.deferReply({ ephemeral: true });
  
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
  ];
  for (const roleId of config.staffRoleIds || []) overwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] });
  
  const parentId = categoryId(category);
  const parent = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;
  const safeName = `${category}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
  const channel = await guild.channels.create({ name: safeName || `ticket-${interaction.user.id}`, type: ChannelType.GuildText, ...(parent?.type === ChannelType.GuildCategory ? { parent: parent.id } : {}), topic: `Ticket creator: ${interaction.user.id} | Category: ${category}`, permissionOverwrites: overwrites, reason: `Spike.lol ticket opened by ${interaction.user.tag}` });
  
  const now = Date.now();
  store.setTicket(channel.id, { guildId: guild.id, channelId: channel.id, creatorId: interaction.user.id, creatorTag: interaction.user.tag, category, subject, details, createdAt: now, lastCreatorMessageAt: now, lastAnyMessageAt: now, lastAlertAt: 0, alertCount: 0, claimedBy: null, closeRequested: false, alertedMessageIds: [] });
  
  const ticket = store.tickets[channel.id];
  await channel.send({ content: `<@${interaction.user.id}> ${(config.staffRoleIds || []).map(id => `<@&${id}>`).join(' ')}`, embeds: [embed(`🎫 Support Ticket: ${subject}`, `**Category:** \`${category.toUpperCase()}\`\n**Created by:** <@${interaction.user.id}>\n\n**Details:**\n> ${details}\n\n*A Spike.lol team member will be with you shortly. Please remain patient.*`)], components: controlRows(), allowedMentions: { users: [interaction.user.id], roles: config.staffRoleIds || [] } });
  
  await interaction.editReply({ content: `✨ Your ticket has been created successfully: ${channel}` });
  await log(guild, `Ticket created: ${channel} by <@${interaction.user.id>> (${category})`);
}

async function closeTicket(channel, actor, reason = 'Ticket closed') {
  const ticket = store.tickets[channel.id]; if (!ticket) return;
  ticket.closing = true; store.saveTickets();
  const guild = channel.guild;
  await channel.send({ embeds: [embed('🔒 Spike.lol · Ticket Closing', `${reason}\nTranscript is being saved securely. This channel will be deleted in 5 seconds.`)] }).catch(() => {});
  await sendTranscript(channel, guild).catch(async e => { await log(guild, `Transcript generation failed for ${channel.name}: ${e.message}`); });
  await log(guild, `Ticket **${channel.name}** closed by ${actor ? `<@${actor.id}>` : 'system'}. Creator: <@${ticket.creatorId}>`);
  store.deleteTicket(channel.id);
  setTimeout(() => channel.delete('Spike.lol ticket closed').catch(() => {}), 5000);
}

async function sendInactivityDM(guild, channelId, ticket, force = false) {
  if (!config.inactivityAlertsEnabled && !force) return false;
  const user = await client.users.fetch(ticket.creatorId).catch(() => null);
  if (!user) return false;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`inactivity_still:${channelId}`).setLabel("I'm still here").setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`inactivity_close:${channelId}`).setLabel('Request closure').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
  const dm = embed('Spike.lol · Ticket Reminder', `Hey! Your ticket in **${guild.name}** has had no reply from you for a while.\n\n**Subject:** ${ticket.subject || 'Support request'}\n\nIf you still need help, tap **I'm still here**. If you no longer need help, tap **Request closure**.`);
  try {
    await user.send({ embeds: [dm], components: [row] });
    ticket.lastAlertAt = Date.now(); ticket.alertCount = (ticket.alertCount || 0) + 1; store.saveTickets();
    await log(guild, `Inactivity reminder DM sent to <@${ticket.creatorId}> for ticket <#${channelId}>.`);
    return true;
  } catch (e) {
    return false;
  }
}

function buildCommands() {
 const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
 return [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the Spike.lol premium ticket panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('alertwarning').setDescription('Send or configure ticket inactivity reminders')
    .addSubcommand(s => s.setName('send').setDescription('Immediately DM this ticket creator a reminder'))
    .addSubcommand(s => s.setName('set-hours').setDescription('Set the inactivity threshold in hours').addIntegerOption(o => o.setName('hours').setDescription('Hours without a creator reply').setMinValue(1).setMaxValue(720).setRequired(true)))
    .addSubcommand(s => s.setName('toggle').setDescription('Enable or disable automatic inactivity alerts').addBooleanOption(o => o.setName('enabled').setDescription('Enable alerts').setRequired(true))),
  new SlashCommandBuilder().setName('aletwarning').setDescription('Alias: send an inactivity reminder to this ticket creator'),
  new SlashCommandBuilder().setName('ticketblock').setDescription('Block a user from creating tickets').addUserOption(o => o.setName('user').setDescription('User to block').setRequired(true)),
  new SlashCommandBuilder().setName('ticketunblock').setDescription('Unblock a user from creating tickets').addUserOption(o => o.setName('user').setDescription('User to unblock').setRequired(true)),
  new SlashCommandBuilder().setName('ticketconfig').setDescription('Show current ticket configuration'),
 ].map(c => c.toJSON());
}

client.once(Events.ClientReady, async c => {
 console.log(`Logged in as ${c.user.tag}`);
 console.log(`Loaded ${Object.keys(store.tickets).length} active ticket records.`);
 if (process.env.CLIENT_ID && process.env.GUILD_ID) {
  try { const { REST, Routes } = require('discord.js'); const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN); await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: buildCommands() }); console.log('Guild slash commands registered.'); }
  catch (e) { console.error('Slash command registration failed:', e.message); }
 }
});

client.on(Events.MessageCreate, async message => {
 if (message.author.bot || !message.guild) return;
 const ticket = store.tickets[message.channel.id];
 if (ticket) {
  ticket.lastAnyMessageAt = Date.now();
  if (message.author.id === ticket.creatorId) { ticket.lastCreatorMessageAt = Date.now(); ticket.lastAlertAt = 0; ticket.alertCount = 0; }
  store.saveTickets();
 }
 const prefix = String(config.prefix || 'v');
 if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;
 const args = message.content.slice(prefix.length).trim().split(/\s+/); const command = (args.shift() || '').toLowerCase();
 const staff = isStaff(message.member);
 
 if (command === 'help') return message.reply({ embeds: [embed('Spike.lol Ticket Bot Commands', `**Prefix:** \`${prefix}\`\n\`${prefix}panel\` — Post premium ticket panel (Manage Server)\n\`${prefix}claim\` / \`${prefix}unclaim\` — Claim status\n\`${prefix}add @user\` / \`${prefix}remove @user\` — Manage ticket access\n\`${prefix}rename new-name\` — Rename ticket channel\n\`${prefix}transcript\` — Generate HTML transcript\n\`${prefix}close\` — Close ticket\n\`${prefix}block @user\` / \`${prefix}unblock @user\` — Block/Unblock user`)] });
 
 if (command === 'panel') { 
   if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isOwner(message.author.id)) return message.reply('❌ You need Manage Server or bot-owner access to post the panel.'); 
   return message.channel.send({ embeds: [embed('🎫 Spike.lol Support Center', 'Welcome to **Spike.lol** Support! Need assistance? Select an appropriate category from the dropdown menu below to open a private ticket.\n\n> *Please do not open duplicate tickets unnecessarily.*', 0x5865F2)], components: [panelRow()] }); 
 }
 
 if (!ticket && !['block','unblock'].includes(command)) return;
 if (command === 'claim' || command === 'unclaim') { if (!staff) return message.reply('Only configured staff can do that.'); ticket.claimedBy = command === 'claim' ? message.author.id : null; store.saveTickets(); return message.channel.send({ embeds: [embed(command === 'claim' ? 'Ticket Claimed' : 'Ticket Unclaimed', command === 'claim' ? `Claimed by ${message.author}.` : `Unclaimed by ${message.author}.`)] }); }
 if (command === 'close') { if (!staff && message.author.id !== ticket.creatorId) return message.reply('Only the ticket creator or staff can close this ticket.'); return closeTicket(message.channel, message.author, 'Closed by staff request'); }
 if (command === 'rename') { if (!staff) return message.reply('Only staff can rename tickets.'); const name = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,90); if (!name) return message.reply('Usage: vrename new-name'); await message.channel.setName(name); return message.reply(`Ticket renamed to **${name}**.`); }
});

client.on(Events.InteractionCreate, async interaction => {
 try {
  if (interaction.isChatInputCommand()) {
   if (interaction.commandName === 'ticketpanel') {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) && !isOwner(interaction.user.id)) return interaction.reply({ content: '❌ You need Manage Server or bot-owner access.', ephemeral: true });
    return interaction.reply({ embeds: [embed('🎫 Spike.lol Support Center', 'Welcome to **Spike.lol** Support! Need assistance? Select an appropriate category from the dropdown menu below to open a private ticket.\n\n> *Please do not open duplicate tickets unnecessarily.*', 0x5865F2)], components: [panelRow()] });
   }
   if (interaction.commandName === 'ticketconfig') { if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true }); return interaction.reply({ embeds: [embed('Spike.lol Ticket Configuration', `**Brand:** Spike.lol\n**Prefix:** ${config.prefix}\n**Active tickets:** ${Object.keys(store.tickets).length}`)], ephemeral: true }); }
  }
  
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
   const category = interaction.values[0];
   const modal = new ModalBuilder().setCustomId(`ticket_create:${category}`).setTitle(`Spike.lol · ${category.replace('_', ' ').toUpperCase()}`);
   modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Describe your request in detail').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true))
   ); 
   return interaction.showModal(modal);
  }
  
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_create:')) {
    return createTicket(interaction, interaction.customId.split(':')[1], interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('details'));
  }
  
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
   const ticket = getTicket(interaction); if (!ticket) return interaction.reply({ content: 'This is not an active ticket channel.', ephemeral: true });
   const staff = hasStaffRole(interaction.member);
   if (interaction.customId === 'ticket_claim' || interaction.customId === 'ticket_unclaim') { if (!staff) return interaction.reply({ content: 'Staff only.', ephemeral: true }); const claim = interaction.customId === 'ticket_claim'; ticket.claimedBy = claim ? interaction.user.id : null; store.saveTickets(); await interaction.reply({ embeds: [embed(claim ? 'Ticket Claimed' : 'Ticket Unclaimed', claim ? `${interaction.user} is now handling this ticket.` : `${interaction.user} released this ticket.`)] }); return; }
   if (interaction.customId === 'ticket_transcript') { if (!staff) return interaction.reply({ content: 'Staff only.', ephemeral: true }); await interaction.deferReply({ ephemeral: true }); const result = await sendTranscript(interaction.channel, interaction.guild); return interaction.editReply({ content: `Transcript saved successfully (${result.messageCount} messages).`, files: [new AttachmentBuilder(result.filepath, { name: result.filename })] }); }
   if (interaction.customId === 'ticket_close') { if (!staff && interaction.user.id !== ticket.creatorId) return interaction.reply({ content: 'Only staff or ticket creator can close this ticket.', ephemeral: true }); await interaction.reply({ content: 'Closing ticket and saving transcript…', ephemeral: true }); return closeTicket(interaction.channel, interaction.user, 'Closed by staff'); }
  }
 } catch (e) { console.error('Interaction error:', e); }
});

client.login(process.env.DISCORD_TOKEN);

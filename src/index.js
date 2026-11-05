require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express'); // Render keep-alive ke liye
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
const categories = [
  { label: 'Support', value: 'support', description: 'General help and technical support', emoji: '🛟' },
  { label: 'Partnership', value: 'partnership', description: 'Partnership and creator inquiries', emoji: '🤝' },
  { label: 'Report', value: 'report', description: 'Report a player or an issue', emoji: '🚩' },
  { label: 'Billing', value: 'billing', description: 'Payments, orders, and billing', emoji: '💳' },
  { label: 'Other', value: 'other', description: 'Anything that does not fit elsewhere', emoji: '📩' }
];
const pendingClose = new Set();
const panelRow = () => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_category_select').setPlaceholder('Choose a ticket category…').addOptions(categories));
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
  if (ch?.isTextBased()) await ch.send({ embeds: [embed('Ticket Log', message)] }).catch(() => {});
}
async function sendTranscript(channel, guild) {
  const result = await makeTranscript(channel);
  const attachment = new AttachmentBuilder(result.filepath, { name: result.filename });
  const transcriptChannel = config.transcriptChannelId ? await guild.channels.fetch(config.transcriptChannelId).catch(() => null) : null;
  if (transcriptChannel?.isTextBased()) await transcriptChannel.send({ embeds: [embed('Ticket Transcript', `Transcript for **${channel.name}** · ${result.messageCount} messages.`)], files: [attachment] });
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
  const channel = await guild.channels.create({ name: safeName || `ticket-${interaction.user.id}`, type: ChannelType.GuildText, ...(parent?.type === ChannelType.GuildCategory ? { parent: parent.id } : {}), topic: `Ticket creator: ${interaction.user.id} | Category: ${category}`, permissionOverwrites: overwrites, reason: `VaeStudios ticket opened by ${interaction.user.tag}` });
  const now = Date.now();
  store.setTicket(channel.id, { guildId: guild.id, channelId: channel.id, creatorId: interaction.user.id, creatorTag: interaction.user.tag, category, subject, details, createdAt: now, lastCreatorMessageAt: now, lastAnyMessageAt: now, lastAlertAt: 0, alertCount: 0, claimedBy: null, closeRequested: false, alertedMessageIds: [] });
  const ticket = store.tickets[channel.id];
  await channel.send({ content: `<@${interaction.user.id}> ${(config.staffRoleIds || []).map(id => `<@&${id}>`).join(' ')}`, embeds: [embed(`🎫 ${subject}`, `**Category:** ${category}\n**Created by:** ${interaction.user}\n\n${details}\n\nA VaeStudios team member will be with you soon.`)], components: controlRows(), allowedMentions: { users: [interaction.user.id], roles: config.staffRoleIds || [] } });
  await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
  await log(guild, `Ticket created: ${channel} by <@${interaction.user.id}> (${category})`);
}
async function closeTicket(channel, actor, reason = 'Ticket closed') {
  const ticket = store.tickets[channel.id]; if (!ticket) return;
  ticket.closing = true; store.saveTickets();
  const guild = channel.guild;
  await channel.send({ embeds: [embed('Ticket closing', `${reason}\nTranscript is being saved. This channel will be deleted in a few seconds.`)] }).catch(() => {});
  await sendTranscript(channel, guild).catch(async e => { await log(guild, `Transcript generation failed for ${channel.name}: ${e.message}`); });
  await log(guild, `Ticket **${channel.name}** closed by ${actor ? `<@${actor.id}>` : 'system'}. Creator: <@${ticket.creatorId}>`);
  store.deleteTicket(channel.id);
  setTimeout(() => channel.delete('VaeStudios ticket closed').catch(() => {}), 5000);
}
async function sendInactivityDM(guild, channelId, ticket, force = false) {
  if (!config.inactivityAlertsEnabled && !force) return false;
  const user = await client.users.fetch(ticket.creatorId).catch(() => null);
  if (!user) return false;
  const hours = Number(config.inactivityHours) || 24;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`inactivity_still:${channelId}`).setLabel("I'm still here").setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`inactivity_close:${channelId}`).setLabel('Request closure').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
  const dm = embed('VaeStudios · Ticket reminder', `Hey! Your ticket in **${guild.name}** has had no reply from you for a while.\n\n**Ticket:** #${(await guild.channels.fetch(channelId).catch(() => null))?.name || channelId}\n**Subject:** ${ticket.subject || 'Support request'}\n\nIf you still need help, tap **I'm still here**. If you no longer need help, tap **Request closure**. We won't close it without your confirmation.`);
  try {
    await user.send({ embeds: [dm], components: [row] });
    ticket.lastAlertAt = Date.now(); ticket.alertCount = (ticket.alertCount || 0) + 1; store.saveTickets();
    await log(guild, `Inactivity reminder DM sent to <@${ticket.creatorId}> for ticket <#${channelId}>.`);
    return true;
  } catch (e) {
    await log(guild, `⚠️ Could not DM <@${ticket.creatorId}> about <#${channelId}>. Their DMs may be closed.`);
    return false;
  }
}
async function alertCommand(interaction, force = false) {
  if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Only configured staff or the bot owner can use this command.', ephemeral: true });
  const ticket = getTicket(interaction);
  if (!ticket) return interaction.reply({ content: 'Run this inside an active ticket channel.', ephemeral: true });
  const sent = await sendInactivityDM(interaction.guild, interaction.channelId, ticket, force);
  return interaction.reply({ content: sent ? `Inactivity reminder DM sent to <@${ticket.creatorId}>.` : `Could not deliver the DM to <@${ticket.creatorId}>. They may have DMs disabled.`, ephemeral: true });
}
function buildCommands() {
 const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
 return [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the VaeStudios ticket dropdown panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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
 setInterval(async () => {
  if (!config.inactivityAlertsEnabled) return;
  const now = Date.now(), threshold = (Number(config.inactivityHours) || 24) * 3600000;
  for (const [channelId, ticket] of Object.entries(store.tickets)) {
   if (ticket.closing || ticket.closeRequested) continue;
   if (now - (ticket.lastCreatorMessageAt || ticket.createdAt) < threshold) continue;
   if (ticket.lastAlertAt && now - ticket.lastAlertAt < threshold) continue;
   const guild = await client.guilds.fetch(ticket.guildId).catch(() => null); if (!guild) continue;
   await sendInactivityDM(guild, channelId, ticket, false);
  }
 }, 5 * 60 * 1000);
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
 if (command === 'help') return message.reply({ embeds: [embed('VaeStudios Ticket Bot Commands', `**Prefix:** \`${prefix}\`\n\`${prefix}panel\` — post ticket panel (Manage Server)\n\`${prefix}claim\` / \`${prefix}unclaim\` — claim status\n\`${prefix}add @user\` / \`${prefix}remove @user\` — manage access\n\`${prefix}rename new-name\` — rename ticket\n\`${prefix}transcript\` — generate HTML transcript\n\`${prefix}close\` — close ticket\n\`${prefix}alertwarning\` — DM creator a reminder\n\`${prefix}block @user\` / \`${prefix}unblock @user\` — ticket access block\nSlash commands: \`/ticketpanel\`, \`/alertwarning\`, \`/aletwarning\`, \`/ticketconfig\``)] });
 if (command === 'panel') { if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isOwner(message.author.id)) return message.reply('You need Manage Server or bot-owner access.'); return message.channel.send({ embeds: [embed('🎫 VaeStudios Support', 'Need help from the VaeStudios team? Select a category below to open a private ticket. Please do not open duplicate tickets.')], components: [panelRow()] }); }
 if (!ticket && !['block','unblock'].includes(command)) return;
 if (command === 'claim' || command === 'unclaim') { if (!staff) return message.reply('Only configured staff can do that.'); ticket.claimedBy = command === 'claim' ? message.author.id : null; store.saveTickets(); return message.channel.send({ embeds: [embed(command === 'claim' ? 'Ticket claimed' : 'Ticket unclaimed', command === 'claim' ? `Claimed by ${message.author}.` : `Unclaimed by ${message.author}.`)] }); }
 if (command === 'close') { if (!staff && message.author.id !== ticket.creatorId) return message.reply('Only the ticket creator or staff can close this ticket.'); if (!staff && message.author.id === ticket.creatorId) { ticket.closeRequested = true; store.saveTickets(); await message.channel.send({ embeds: [embed('Closure requested', `${message.author} has asked to close this ticket. Staff: please confirm and close it if appropriate.`)] }); return message.reply('Your closure request has been sent to the team. A staff member will confirm before the ticket is closed.'); } return closeTicket(message.channel, message.author, 'Closed by staff'); }
 if (command === 'alertwarning' || command === 'aletwarning' || command === 'alert') { const fake = { member: message.member, guild: message.guild, channelId: message.channel.id, reply: options => message.reply(options.content || options), }; if (!staff) return message.reply('Only configured staff can send an inactivity alert.'); if (!ticket) return message.reply('Use this inside an active ticket.'); const sent = await sendInactivityDM(message.guild, message.channel.id, ticket, true); return message.reply(sent ? `Reminder DM sent to <@${ticket.creatorId}>.` : 'Could not send DM. The user may have DMs disabled.'); }
 if (command === 'rename') { if (!staff) return message.reply('Only configured staff can rename tickets.'); const name = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,90); if (!name) return message.reply('Usage: vrename new-ticket-name'); await message.channel.setName(name); return message.reply(`Ticket renamed to **${name}**.`); }
 if (command === 'add' || command === 'remove') { if (!staff) return message.reply('Only configured staff can manage ticket access.'); const user = message.mentions.users.first(); if (!user) return message.reply(`Usage: v${command} @user`); await message.channel.permissionOverwrites.edit(user.id, command === 'add' ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }); return message.reply(`${command === 'add' ? 'Added' : 'Removed'} ${user} ${command === 'add' ? 'to' : 'from'} this ticket.`); }
 if (command === 'transcript') { if (!staff) return message.reply('Only configured staff can generate transcripts.'); await message.channel.send('Generating transcript…'); const result = await sendTranscript(message.channel, message.guild); return message.channel.send({ content: `Transcript generated (${result.messageCount} messages).`, files: [new AttachmentBuilder(result.filepath, { name: result.filename })] }); }
 if (command === 'block' || command === 'unblock') { if (!isOwner(message.author.id)) return message.reply('Only the configured bot owner can block or unblock users.'); const user = message.mentions.users.first(); if (!user) return message.reply(`Usage: v${command} @user`); config.blockedUsers ||= []; config.blockedUsers = command === 'block' ? [...new Set([...config.blockedUsers, user.id])] : config.blockedUsers.filter(id => id !== user.id); fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2)); return message.reply(`${user} ${command === 'block' ? 'is now blocked from opening tickets' : 'has been unblocked'}.`); }
});
client.on(Events.InteractionCreate, async interaction => {
 try {
  if (interaction.isChatInputCommand()) {
   if (interaction.commandName === 'ticketpanel') {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) && !isOwner(interaction.user.id)) return interaction.reply({ content: 'You need Manage Server or bot-owner access.', ephemeral: true });
    return interaction.reply({ embeds: [embed('🎫 VaeStudios Support', 'Need help from the VaeStudios team? Select a category below to open a private ticket. Please do not open duplicate tickets.')], components: [panelRow()] });
   }
   if (interaction.commandName === 'alertwarning') {
    if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Only configured staff or the bot owner can use this command.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'set-hours') { config.inactivityHours = interaction.options.getInteger('hours'); fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2)); return interaction.reply({ content: `Inactivity reminder threshold set to **${config.inactivityHours} hours**.`, ephemeral: true }); }
    if (sub === 'toggle') { config.inactivityAlertsEnabled = interaction.options.getBoolean('enabled'); fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2)); return interaction.reply({ content: `Automatic inactivity alerts are now **${config.inactivityAlertsEnabled ? 'enabled' : 'disabled'}**.`, ephemeral: true }); }
    return alertCommand(interaction, true);
   }
   if (interaction.commandName === 'aletwarning') return alertCommand(interaction, true);
   if (interaction.commandName === 'ticketconfig') { if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true }); return interaction.reply({ embeds: [embed('Ticket Configuration', `**Brand:** ${config.brandName}\n**Prefix:** ${config.prefix}\n**Inactivity:** ${config.inactivityHours} hours\n**Automatic alerts:** ${config.inactivityAlertsEnabled ? 'Enabled' : 'Disabled'}\n**Staff roles configured:** ${(config.staffRoleIds || []).length}\n**Active tickets:** ${Object.keys(store.tickets).length}\n**Transcript channel:** ${config.transcriptChannelId || 'Not configured'}`)], ephemeral: true }); }
   if (interaction.commandName === 'ticketblock' || interaction.commandName === 'ticketunblock') { if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'Only the bot owner can manage the ticket block list.', ephemeral: true }); const user = interaction.options.getUser('user'); config.blockedUsers ||= []; config.blockedUsers = interaction.commandName === 'ticketblock' ? [...new Set([...config.blockedUsers, user.id])] : config.blockedUsers.filter(id => id !== user.id); fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2)); return interaction.reply({ content: `${user} ${interaction.commandName === 'ticketblock' ? 'blocked from opening tickets' : 'unblocked'}.`, ephemeral: true }); }
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
   const category = interaction.values[0];
   const modal = new ModalBuilder().setCustomId(`ticket_create:${category}`).setTitle(`${category[0].toUpperCase()}${category.slice(1)} Ticket`);
   modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Describe your request').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true))
   ); return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_create:')) return createTicket(interaction, interaction.customId.split(':')[1], interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('details'));
  if (interaction.isButton() && interaction.customId.startsWith('inactivity_')) {
   const [action, channelId] = interaction.customId.split(':');
   const guild = client.guilds.cache.find(g => g.channels.cache.has(channelId)) || await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
   const ticket = store.tickets[channelId]; if (!ticket || ticket.creatorId !== interaction.user.id) return interaction.reply({ content: 'This reminder is no longer active or it was not issued for your account.', ephemeral: true });
   if (action === 'inactivity_still') { ticket.lastCreatorMessageAt = Date.now(); ticket.lastAlertAt = 0; ticket.alertCount = 0; ticket.closeRequested = false; store.saveTickets(); const ch = await guild?.channels.fetch(channelId).catch(() => null); if (ch) await ch.send({ content: `<@${interaction.user.id}> confirmed they still need help.`, allowedMentions: { users: [interaction.user.id] } }).catch(() => {}); return interaction.update({ embeds: [embed('Thanks for confirming!', 'Your ticket will stay open. The VaeStudios team can continue helping you there.')], components: [] }); }
   if (action === 'inactivity_close') { ticket.closeRequested = true; store.saveTickets(); const ch = await guild?.channels.fetch(channelId).catch(() => null); if (ch) await ch.send({ embeds: [embed('Closure requested', `<@${interaction.user.id}> requested to close this ticket from the inactivity reminder. A staff member must confirm before it is closed.`)] }).catch(() => {}); return interaction.update({ embeds: [embed('Closure request sent', 'We have asked the VaeStudios team to confirm your closure request. Your ticket will remain open until staff closes it.')], components: [] }); }
  }
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
   const ticket = getTicket(interaction); if (!ticket) return interaction.reply({ content: 'This is not an active ticket.', ephemeral: true });
   const staff = hasStaffRole(interaction.member);
   if (interaction.customId === 'ticket_claim' || interaction.customId === 'ticket_unclaim') { if (!staff) return interaction.reply({ content: 'Only configured staff can claim tickets.', ephemeral: true }); const claim = interaction.customId === 'ticket_claim'; if (claim && ticket.claimedBy && ticket.claimedBy !== interaction.user.id) return interaction.reply({ content: `Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true }); ticket.claimedBy = claim ? interaction.user.id : null; store.saveTickets(); await interaction.reply({ embeds: [embed(claim ? 'Ticket claimed' : 'Ticket unclaimed', claim ? `${interaction.user} is now handling this ticket.` : `${interaction.user} released this ticket.`)] }); return; }
   if (interaction.customId === 'ticket_transcript') { if (!staff) return interaction.reply({ content: 'Only configured staff can generate transcripts.', ephemeral: true }); await interaction.deferReply({ ephemeral: true }); const result = await sendTranscript(interaction.channel, interaction.guild); return interaction.editReply({ content: `Transcript saved (${result.messageCount} messages).`, files: [new AttachmentBuilder(result.filepath, { name: result.filename })] }); }
   if (interaction.customId === 'ticket_close') { if (!staff && interaction.user.id !== ticket.creatorId) return interaction.reply({ content: 'Only the ticket creator or staff can close this ticket.', ephemeral: true }); if (!staff) { ticket.closeRequested = true; store.saveTickets(); await interaction.channel.send({ embeds: [embed('Closure requested', `${interaction.user} asked to close this ticket. Staff must confirm before closure.`)] }); return interaction.reply({ content: 'Your closure request was sent to staff. The ticket stays open until staff confirms.', ephemeral: true }); } await interaction.reply({ content: 'Closing ticket and saving transcript…', ephemeral: true }); return closeTicket(interaction.channel, interaction.user, 'Closed by staff'); }
   if (interaction.customId === 'ticket_add_user' || interaction.customId === 'ticket_remove_user') { if (!staff) return interaction.reply({ content: 'Only configured staff can manage ticket access.', ephemeral: true }); const modal = new ModalBuilder().setCustomId(`${interaction.customId}:${interaction.channelId}`).setTitle(interaction.customId === 'ticket_add_user' ? 'Add user to ticket' : 'Remove user from ticket').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('Discord user ID').setStyle(TextInputStyle.Short).setRequired(true))); return interaction.showModal(modal); }
   if (interaction.customId === 'ticket_rename') { if (!staff) return interaction.reply({ content: 'Only configured staff can rename tickets.', ephemeral: true }); const modal = new ModalBuilder().setCustomId(`ticket_rename_modal:${interaction.channelId}`).setTitle('Rename ticket').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New channel name').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true))); return interaction.showModal(modal); }
  }
  if (interaction.isModalSubmit() && (interaction.customId.startsWith('ticket_add_user:') || interaction.customId.startsWith('ticket_remove_user:'))) {
   if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true }); const [, channelId] = interaction.customId.split(':'); const userId = interaction.fields.getTextInputValue('user_id').trim().replace(/[<@!>]/g, ''); if (!/^\d{15,22}$/.test(userId)) return interaction.reply({ content: 'Please enter a valid Discord user ID.', ephemeral: true }); const channel = await interaction.guild.channels.fetch(channelId).catch(() => null); if (!channel) return interaction.reply({ content: 'Ticket channel not found.', ephemeral: true }); const add = interaction.customId.startsWith('ticket_add_user:'); await channel.permissionOverwrites.edit(userId, add ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }); return interaction.reply({ content: `${add ? 'Added' : 'Removed'} <@${userId}> ${add ? 'to' : 'from'} the ticket.`, ephemeral: true });
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_rename_modal:')) { if (!hasStaffRole(interaction.member)) return interaction.reply({ content: 'Staff only.', ephemeral: true }); const [, channelId] = interaction.customId.split(':'); const channel = await interaction.guild.channels.fetch(channelId).catch(() => null); const name = interaction.fields.getTextInputValue('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0,90); if (!channel || !name) return interaction.reply({ content: 'Invalid channel name.', ephemeral: true }); await channel.setName(name); return interaction.reply({ content: `Ticket renamed to **${name}**.`, ephemeral: true }); }
 } catch (e) { console.error('Interaction error:', e); if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Something went wrong. Check the bot console for details.', ephemeral: true }).catch(() => {}); }
});
client.login(process.env.DISCORD_TOKEN);

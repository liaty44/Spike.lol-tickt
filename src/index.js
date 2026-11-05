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

// --- PREMIUM TICKET CATEGORIES WITH COOL EMOJIS ---
const categories = [
  { label: 'General Support', value: 'support', description: 'Get help regarding server general questions', emoji: '💬' },
  { label: 'Staff Report', value: 'report', description: 'Report a staff member or rule breaker safely', emoji: '🛡️' },
  { label: 'Partnership & Promo', value: 'partnership', description: 'Inquire about server partnerships or promotions', emoji: '🤝' },
  { label: 'Store & Billing', value: 'billing', description: 'Payments, rank purchases, and store issues', emoji: '💳' },
  { label: 'Custom Bot Setup', value: 'botsetup', description: 'Get assistance with custom bots or development', emoji: '🤖' },
  { label: 'Appeal & Unban', value: 'appeal', description: 'Submit ban or mute appeal requests', emoji: '⚖️' },
  { label: 'Other Queries', value: 'other', description: 'Anything else that does not fit above', emoji: '📩' }
];

const pendingClose = new Set();
const panelRow = () => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_category_select').setPlaceholder('📂 Select your query category...').addOptions(categories));

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
  if (transcriptChannel?.isTextBased()) await transcriptChannel.send({ embeds: [embed('Spike.lol Transcript', `Transcript for **${channel.name}** · ${result.messageCount} messages.`)], files: [attachment] });
  return result;
}

// --- SECURE & PRIVATE TICKET CREATION ---
async function createTicket(interaction, category, subject, details) {
  const guild = interaction.guild;
  if (isBlocked(interaction.user.id)) return interaction.reply({ content: '❌ You are currently blocked from opening tickets.', ephemeral: true });
  
  const openCount = Object.values(store.tickets).filter(t => t.guildId === guild.id && t.creatorId === interaction.user.id && !t.closing).length;
  if (openCount >= (config.maxOpenTicketsPerUser || 3)) return interaction.reply({ content: `❌ Aapka pehle se hi ${openCount} open ticket hai. Pehle usko close karein!`, ephemeral: true });
  
  await interaction.deferReply({ ephemeral: true });

  // STRICT PERMISSIONS: Bot members / @everyone can't view, only Ticket Creator and Staff Roles can!
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
  ];
  for (const roleId of config.staffRoleIds || []) {
    overwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] });
  }

  const parentId = categoryId(category);
  const parent = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;
  const safeName = `${category}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
  
  const channel = await guild.channels.create({
    name: safeName || `ticket-${interaction.user.id}`,
    type: ChannelType.GuildText,
    ...(parent?.type === ChannelType.GuildCategory ? { parent: parent.id } : {}),
    topic: `Ticket creator: ${interaction.user.id} | Category: ${category}`,
    permissionOverwrites: overwrites,
    reason: `Spike.lol ticket opened by ${interaction.user.tag}`
  });

  const now = Date.now();
  store.setTicket(channel.id, { guildId: guild.id, channelId: channel.id, creatorId: interaction.user.id, creatorTag: interaction.user.tag, category, subject, details, createdAt: now, lastCreatorMessageAt: now, lastAnyMessageAt: now, lastAlertAt: 0, alertCount: 0, claimedBy: null, closeRequested: false, alertedMessageIds: [] });
  
  const ticket = store.tickets[channel.id];

  // PREMIUM TICKET WELCOME EMBED INSIDE THE PRIVATE CHANNEL
  const welcomeEmbed = new discord.EmbedBuilder()
    .setTitle(`✨ SPIKE.LOL TICKET [ ${category.toUpperCase()} ] ✨`)
    .setDescription(`> Hello ${interaction.user.mention},\n> Apni problem ya query ki details niche share karein. Hamari staff team jald hi aapki madad karegi.\n\n📌 **Subject:** ${subject}\n📝 **Details:** ${details}\n\n🔒 *Neeche diye gaye buttons ka use karke aap ticket ko manage ya close kar sakte hain.*`)
    .setColor(0x2b2d31)
    .setTimestamp()
    .setFooter({ text: '⚡ Spike.lol Security & Support System' });

  await channel.send({ 
    content: `<@${interaction.user.id}> ${(config.staffRoleIds || []).map(id => `<@&${id}>`).join(' ')}`, 
    embeds: [welcomeEmbed], 
    components: controlRows(), 
    allowedMentions: { users: [interaction.user.id], roles: config.staffRoleIds || [] } 
  });

  await interaction.editReply({ content: `✅ Aapka secure ticket successfully ban gaya hai: ${channel}` });
  await log(guild, `Ticket created: ${channel} by <@${interaction.user.id>> (${category})`);
}

async function closeTicket(channel, actor, reason = 'Ticket closed') {
  const ticket = store.tickets[channel.id]; if (!ticket) return;
  ticket.closing = true; store.saveTickets();
  const guild = channel.guild;
  await channel.send({ embeds: [embed('🔒 Spike.lol Ticket Closing', `${reason}\nTranscript save ho raha hai. Yeh channel 5 seconds me delete ho jayega.`)] }).catch(() => {});
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
  const dm = embed('Spike.lol · Ticket Reminder', `Hey! Your ticket in **${guild.name}** has had no reply for a while.\n\nIf you still need assistance, click **I'm still here**. If your issue is resolved, click **Request closure**.`);
  try {
    await user.send({ embeds: [dm], components: [row] });
    ticket.lastAlertAt = Date.now(); ticket.alertCount = (ticket.alertCount || 0) + 1; store.saveTickets();
    return true;
  } catch (e) {
    return false;
  }
}

function buildCommands() {
 const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
 return [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Post the Spike.lol ticket dropdown panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('alertwarning').setDescription('Send ticket inactivity reminders').addSubcommand(s => s.setName('send').setDescription('Send reminder DM')).addSubcommand(s => s.setName('set-hours').setDescription('Set hours').addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true))).addSubcommand(s => s.setName('toggle').setDescription('Toggle alerts').addBooleanOption(o => o.setName('enabled').setDescription('Enabled').setRequired(true))),
  new SlashCommandBuilder().setName('ticketblock').setDescription('Block user from tickets').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('ticketunblock').setDescription('Unblock user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('ticketconfig').setDescription('Show ticket configuration'),
 ].map(c => c.toJSON());
}

client.once(Events.ClientReady, async c => {
 console.log(`[READY] Logged in as ${c.user.tag}`);
 if (process.env.CLIENT_ID && process.env.GUILD_ID) {
  try { const { REST, Routes } = require('discord.js'); const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN); await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: buildCommands() }); console.log('[SlashCmds] Slash commands registered successfully.'); }
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

 if (command === 'help') return message.reply({ embeds: [embed('Spike.lol Ticket Bot Commands', `**Prefix:** \`${prefix}\`\n\`${prefix}panel\` — post ticket panel\n\`${prefix}claim\` / \`${prefix}unclaim\` — claim status\n\`${prefix}close\` — close ticket\n\`${prefix}transcript\` — generate transcript`)] });
 
 // --- PREMIUM TICKET PANEL COMMAND (`vpanel`) ---
 if (command === 'panel') { 
   if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isOwner(message.author.id)) return message.reply('❌ You need Manage Server permissions.'); 
   
   const panelEmbed = new discord.EmbedBuilder()
     .setTitle("✨ **SPIKE.LOL OFFICIAL SUPPORT DESK** ✨")
     .setDescription("> **Need assistance or want to talk with staff?**\n> Neeche diye gaye **Select Menu** se apni problem ki category choose karein aur apna private ticket instant create karein!\n\n📌 **Rules:** Do not spam tickets unnecessarily. Respect staff members.")
     .setColor(0x2b2d31)
     .setImage("https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop") // Sleek Dark Banner
     .setFooter({ text: "⚡ Powered by Spike.lol Secure Systems" });

   try { await message.delete(); } catch(e) {}
   return message.channel.send({ embeds: [panelEmbed], components: [panelRow()] }); 
 }

 if (!ticket && !['block','unblock'].includes(command)) return;
 if (command === 'close') { return closeTicket(message.channel, message.author, 'Closed by staff command'); }
});

client.on(Events.InteractionCreate, async interaction => {
 try {
  if (interaction.isChatInputCommand()) {
   if (interaction.commandName === 'ticketpanel') {
    const panelEmbed = new discord.EmbedBuilder()
      .setTitle("✨ **SPIKE.LOL OFFICIAL SUPPORT DESK** ✨")
      .setDescription("> **Need assistance or want to talk with staff?**\n> Select a category from the menu below to open a private ticket instantly!")
      .setColor(0x2b2d31)
      .setFooter({ text: "⚡ Powered by Spike.lol Secure Systems" });
    return interaction.reply({ embeds: [panelEmbed], components: [panelRow()] });
   }
  }

  // --- SELECT MENU CATEGORY MODAL OPENER ---
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
   const category = interaction.values[0];
   const modal = new ModalBuilder().setCustomId(`ticket_create:${category}`).setTitle(`Spike.lol — ${category.toUpperCase()} Ticket`);
   modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Describe your query in detail').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true))
   ); 
   return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_create:')) {
    return createTicket(interaction, interaction.customId.split(':')[1], interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('details'));
  }

  // --- BUTTON ACTIONS (Claim, Transcript, Close, etc.) ---
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
   const ticket = getTicket(interaction); if (!ticket) return interaction.reply({ content: '❌ Yeh active ticket nahi hai.', ephemeral: true });
   const staff = hasStaffRole(interaction.member);
   
   if (interaction.customId === 'ticket_claim' || interaction.customId === 'ticket_unclaim') { 
     if (!staff) return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true }); 
     const claim = interaction.customId === 'ticket_claim'; 
     ticket.claimedBy = claim ? interaction.user.id : null; store.saveTickets(); 
     await interaction.reply({ embeds: [embed(claim ? 'Ticket Claimed' : 'Ticket Unclaimed', claim ? `🛡️ Handled by ${interaction.user}` : `🔄 Released by ${interaction.user}`)] }); 
     return; 
   }
   
   if (interaction.customId === 'ticket_transcript') { 
     if (!staff) return interaction.reply({ content: '❌ Staff only.', ephemeral: true }); 
     await interaction.deferReply({ ephemeral: true }); 
     const result = await sendTranscript(interaction.channel, interaction.guild); 
     return interaction.editReply({ content: `✅ Transcript saved (${result.messageCount} messages).`, files: [new AttachmentBuilder(result.filepath, { name: result.filename })] }); 
   }
   
   if (interaction.customId === 'ticket_close') { 
     if (!staff && interaction.user.id !== ticket.creatorId) return interaction.reply({ content: '❌ Aap is ticket ko close nahi kar sakte.', ephemeral: true }); 
     await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true }); 
     return closeTicket(interaction.channel, interaction.user, 'Closed via button action'); 
   }
  }
 } catch (e) { console.error('Interaction error:', e); }
});

client.login(process.env.DISCORD_TOKEN);

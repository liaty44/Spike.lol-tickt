const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const config = require('../config.json');
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function color() { return /^#[0-9a-f]{6}$/i.test(config.panelColor) ? config.panelColor : '#7C3AED'; }
function embed(title, description) { return new EmbedBuilder().setColor(color()).setTitle(title).setDescription(description).setFooter({ text: config.footerText || 'VaeStudios Support' }).setTimestamp(); }
function isOwner(userId) { return (config.ownerIds || []).includes(userId) || process.env.OWNER_ID === userId; }
function isStaff(member) { return !!member && (isOwner(member.id) || member.permissions?.has(PermissionsBitField.Flags.Administrator) || (config.staffRoleIds || []).some(id => member.roles?.cache?.has(id))); }
function ticketForChannel(channelId, store) { return store.tickets[channelId] || null; }
function categoryId(category) { return config.ticketCategoryIds?.[category] || ''; }
module.exports = { escapeHtml, embed, isOwner, isStaff, ticketForChannel, categoryId };

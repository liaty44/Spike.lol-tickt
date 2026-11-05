const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('./util');
async function makeTranscript(channel) {
  const messages = [];
  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a,b) => a.createdTimestamp - b.createdTimestamp);
  const body = messages.map(m => {
    const text = escapeHtml(m.content || '');
    const embeds = m.embeds.map(e => `<div class="embed">${escapeHtml(e.title || '')}<br>${escapeHtml(e.description || '')}</div>`).join('');
    const files = [...m.attachments.values()].map(a => `<div><a href="${escapeHtml(a.url)}">Attachment: ${escapeHtml(a.name || 'file')}</a></div>`).join('');
    return `<article><header>${escapeHtml(m.author?.tag || 'Unknown')} <time>${new Date(m.createdTimestamp).toISOString()}</time></header><div>${text.replace(/\n/g, '<br>')}</div>${embeds}${files}</article>`;
  }).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ticket transcript - ${escapeHtml(channel.name)}</title><style>body{font:15px system-ui;background:#101018;color:#eee;max-width:950px;margin:30px auto;padding:0 18px}h1{color:#c4b5fd}article{padding:14px;margin:10px 0;background:#1b1b29;border-radius:10px;overflow-wrap:anywhere}header{font-weight:700;margin-bottom:8px;color:#ddd}time{font-size:12px;color:#999;margin-left:8px}.embed{border-left:3px solid #8b5cf6;padding:8px;margin:8px 0}a{color:#c4b5fd}</style></head><body><h1>VaeStudios · ${escapeHtml(channel.name)}</h1><p>Transcript generated ${new Date().toISOString()}</p>${body}</body></html>`;
  const dir = path.join(__dirname, '..', 'transcripts'); fs.mkdirSync(dir, { recursive: true });
  const filename = `${channel.name}-${Date.now()}.html`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filepath = path.join(dir, filename); fs.writeFileSync(filepath, html, 'utf8');
  return { filepath, filename, messageCount: messages.length };
}
module.exports = { makeTranscript };

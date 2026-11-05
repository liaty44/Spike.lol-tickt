const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
function readJson(file, fallback) {
  const p = path.join(dataDir, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { fs.writeFileSync(p, JSON.stringify(fallback, null, 2)); return structuredClone(fallback); }
}
function writeJson(file, data) { fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2)); }
let tickets = readJson('tickets.json', {});
let settings = readJson('settings.json', {});
module.exports = {
  get tickets() { return tickets; },
  get settings() { return settings; },
  saveTickets() { writeJson('tickets.json', tickets); },
  saveSettings() { writeJson('settings.json', settings); },
  setTicket(id, data) { tickets[id] = data; this.saveTickets(); },
  deleteTicket(id) { delete tickets[id]; this.saveTickets(); }
};

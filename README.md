# VaeStudios Ticket Bot

A Discord.js v14 ticket bot adapted from the uploaded WardenCloud ticket-bot concept. It uses a category dropdown, a modal to collect ticket details, private ticket channels, staff claim controls, add/remove user, rename, HTML transcripts, user blocking, and automatic creator-inactivity DM reminders.

## Requirements
- Node.js 20.11 or newer
- A Discord application/bot with **Server Members?** not required; enable **Message Content Intent** for prefix commands.
- Bot invite scopes: `bot` and `applications.commands`
- Permissions: Manage Channels, View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Messages (optional), Use Application Commands.

## Setup
1. Upload/extract this folder on your VPS.
2. Copy `.env.example` to `.env` and fill `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, and `OWNER_ID`.
3. Edit `config.json`:
   - `ownerIds`: bot owner Discord user IDs (or use `OWNER_ID` in `.env`).
   - `staffRoleIds`: staff role IDs, as strings.
   - `ticketCategoryIds`: optional category channel IDs for each ticket type. Leave blank to create tickets at server root.
   - `transcriptChannelId`: channel where HTML transcripts are uploaded.
   - `logChannelId`: optional ticket event log channel.
   - `inactivityHours`: defaults to 24 hours without a creator reply.
4. Install and start:
   ```bash
   npm install
   npm start
   ```
   Slash commands are registered to `GUILD_ID` at startup. Use `vpanel` in the desired panel channel or `/ticketpanel`.
5. In Discord Developer Portal, enable **Message Content Intent** for prefix commands.

## Commands
- `/ticketpanel` or `vpanel` — post dropdown ticket panel
- `/alertwarning send` — DM the current ticket creator immediately
- `/alertwarning set-hours hours:24` — change inactivity threshold
- `/alertwarning toggle enabled:true` — enable/disable automatic alerts
- `/aletwarning` — alias to send the current ticket creator a reminder
- `/ticketconfig` — show configuration summary
- `/ticketblock user:@member` and `/ticketunblock user:@member` — block/unblock ticket creation (owner only)
- Prefix defaults to `v`: `vhelp`, `vclaim`, `vunclaim`, `vadd @member`, `vremove @member`, `vrename new-name`, `vtranscript`, `vclose`, `valertwarning`, `vblock @member`, `vunblock @member`.

## Inactivity behavior
- A creator's own message resets their 24-hour timer.
- Automatic reminder DM includes **I'm still here** and **Request closure** buttons.
- Request closure does not instantly delete the ticket. It posts a notice in the ticket so staff can confirm and close it.
- If the user has DMs disabled or blocks the bot, the bot logs that the DM could not be delivered.

## Important notes
- The bot must be online for the automatic inactivity monitor to run.
- Ticket state is persisted in `data/tickets.json`; configuration is in `config.json`.
- The HTML transcript is also saved locally in `transcripts/` and uploaded to the configured transcript channel.
- Set `OWNER_ID` and staff role IDs before exposing ticket moderation commands.
- Never share `.env` or your bot token. If a token was exposed, reset it in the Discord Developer Portal.

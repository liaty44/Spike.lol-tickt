import { PREFIX } from '../utils/config.js';
import { handleToolsBroadcast } from '../commands/statusTracker.js';

export default {
    name: 'messageCreate',
    async execute(message, client) {
        await handleToolsBroadcast(message, client);

        if (message.author.bot || !message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();

        const cmd = client.prefixCommands.get(cmdName);
        if (!cmd) return;

        try {
            await cmd.prefixExecute(message, args, client);
        } catch (err) {
            console.error(err);
        }
    },
};

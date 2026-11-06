import { ActivityType } from 'discord.js';

export default {
    name: 'clientReady',
    once: true,
    execute(client) {
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
    },
};

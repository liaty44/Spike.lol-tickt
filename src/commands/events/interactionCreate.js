export default {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;
        try {
            await cmd.execute(interaction, client);
        } catch (err) {
            console.error(err);
            if (!interaction.replied) await interaction.reply({ content: 'Error executing command.', ephemeral: true }).catch(() => {});
        }
    }
};

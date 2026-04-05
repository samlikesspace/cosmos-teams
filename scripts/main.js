import { world, system } from "@minecraft/server";

// Verify the API is loading
console.warn("Moderation Mod Loading...");

if (!world.beforeEvents) {
    console.error("CRITICAL: Beta APIs are NOT enabled in World Settings!");
} else {
    const lastChatTime = new Map();

    world.beforeEvents.chatSend.subscribe((event) => {
        const { sender, message } = event;
        const now = Date.now();

        // 1. Spam Protection (1.5s)
        if (lastChatTime.has(sender.id)) {
            const diff = now - lastChatTime.get(sender.id);
            if (diff < 1500) {
                event.cancel = true;
                system.run(() => sender.sendMessage("§cDon't spam!"));
                return;
            }
        }
        lastChatTime.set(sender.id, now);

        // 2. Command Check (.)
        if (message.startsWith(".")) {
            event.cancel = true;
            const args = message.slice(1).split(" ");
            const cmd = args[0].toLowerCase();
            system.run(() => handleCommand(sender, cmd, args));
            return;
        }

        // 3. Chat Formatting
        event.cancel = true;
        let prefix = "§7[Member]§r ";
        let nameColor = sender.hasTag("on_duty") ? "§a" : "§f";

        if (sender.hasTag("rank:admin")) prefix = "§4[Admin]§r ";
        else if (sender.hasTag("rank:mod")) prefix = "§b[Mod]§r ";

        system.run(() => {
            world.sendMessage(`${prefix}${nameColor}${sender.name}§r: ${message}`);
        });
    });
}

function handleCommand(player, cmd, args) {
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");

    if (cmd === "duty" && (isAdmin || isMod)) {
        if (player.hasTag("on_duty")) {
            player.removeTag("on_duty");
            player.nameTag = player.name;
            player.sendMessage("§cShift Ended.");
        } else {
            player.addTag("on_duty");
            player.nameTag = `§a${player.name}`;
            player.sendMessage("§aShift Started!");
        }
    }
    
    if (cmd === "gm" && isAdmin) {
        const mode = args[1] === "1" ? "creative" : "survival";
        player.runCommandAsync(`gamemode ${mode}`);
    }

    if (cmd === "punish" && (isAdmin || isMod)) {
        const target = args[1];
        const type = args[2]; // e.g. .punish PlayerName ban
        if (target) {
            player.runCommandAsync(`kick "${target}" Punished by staff.`);
        }
    }
}

import { world, system } from "@minecraft/server";

const lastChat = new Map();

function findTarget(name) {
    if (!name) return undefined;
    const players = world.getAllPlayers();
    return players.find(p => p.name.toLowerCase() === name.toLowerCase()) || 
           players.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
}

function getSettings() {
    const raw = world.getDynamicProperty("mod_settings");
    if (!raw) return { AntiSpam: true, ChatLogs: true, AutoBan: true, Punishments: true, Ranks: true, Gamemode: true, Teleport: true };
    try { return JSON.parse(raw); } catch { return { AntiSpam: true, ChatLogs: true, AutoBan: true, Punishments: true, Ranks: true, Gamemode: true, Teleport: true }; }
}

function saveSettings(obj) {
    world.setDynamicProperty("mod_settings", JSON.stringify(obj));
}

world.afterEvents.playerSpawn.subscribe((ev) => {
    const { player, initialSpawn } = ev;
    if (!initialSpawn) return;
    if (getSettings().ChatLogs) world.sendMessage(`§7[§a+§7] §f${player.name} §7has joined!`);
    if (player.hasTag("rank:admin") || player.hasTag("rank:mod")) {
        player.sendMessage("§bWelcome back! Use .help to see your staff tools.");
    }
    const banTime = world.getDynamicProperty(`ban_${player.name}`);
    if (banTime && Date.now() < banTime) {
        system.run(() => {
            player.runCommand(`kick "${player.name}" §cYou are currently banned.`);
        });
    }
});

world.afterEvents.playerLeave.subscribe((ev) => {
    if (getSettings().ChatLogs) world.sendMessage(`§7[§c-§7] §f${ev.playerName} §7has left!`);
});

world.beforeEvents.chatSend.subscribe((ev) => {
    const player = ev.sender;
    const msg = ev.message;
    const s = getSettings();

    if (player.getDynamicProperty("shadowMute")) {
        ev.cancel = true;
        system.run(() => player.sendMessage(`§f${player.name}: ${msg}`));
        return;
    }

    if (s.AntiSpam && lastChat.has(player.id) && Date.now() - lastChat.get(player.id) < 1500) {
        ev.cancel = true;
        system.run(() => player.sendMessage("§cSlow down!"));
        return;
    }
    lastChat.set(player.id, Date.now());

    if (msg.startsWith(".")) {
        ev.cancel = true;
        system.run(() => handleCommand(player, msg.slice(1).split(" ")));
        return;
    }

    if (s.Ranks) {
        ev.cancel = true;
        let prefix = player.hasTag("rank:admin") ? "§4[Admin]§r " : (player.hasTag("rank:mod") ? "§b[Mod]§r " : "§7[Member]§r ");
        let nameColor = player.hasTag("on_duty") ? "§a" : "§f";
        system.run(() => world.sendMessage(`${prefix}${nameColor}${player.name}§r: ${msg}`));
    }
});

function handleCommand(player, args) {
    const cmd = args[0].toLowerCase();
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");
    const onDuty = player.hasTag("on_duty");
    const s = getSettings();

    const valid = ["duty", "gm", "punish", "pardon", "sc", "tp", "log", "invsee", "settings", "help"];
    if (!valid.includes(cmd)) return player.sendMessage(`§cError: ".${cmd}" is not a command.`);
    if (!["duty", "help", "settings"].includes(cmd) && (isAdmin || isMod) && !onDuty) return player.sendMessage("§cYou must be .duty to use staff commands!");

    switch (cmd) {
        case "help":
            player.sendMessage("§b--- Staff Help Menu ---");
            player.sendMessage("§b.duty §7- Toggle your staff clock-in status.");
            player.sendMessage("§b.sc [msg] §7- Private chat for Admins and Mods.");
            player.sendMessage("§b.gm [0-3] §7- 0:S, 1:C, 2:A, 3:Spec.");
            player.sendMessage("§b.tp [name] §7- Teleport to a specific player.");
            player.sendMessage("§b.punish [name] [type] [reason] §7- warn, kick, ban, mute, shadowmute, tempban.");
            player.sendMessage("§b.log [name] §7- View a player's punishment history.");
            player.sendMessage("§b.invsee [name] §7- View player inventory and armor.");
            player.sendMessage("§b.pardon [name] §7- Completely wipe a player's data.");
            player.sendMessage("§b.settings [name] §7- Toggle server modules (Admin Only).");
            break;

        case "duty":
            if (!(isAdmin || isMod)) return;
            if (onDuty) {
                player.removeTag("on_duty");
                player.nameTag = player.name;
                player.sendMessage("§bShift Ended.");
            } else {
                player.addTag("on_duty");
                player.nameTag = `§a${player.name}`;
                player.sendMessage("§bShift Started!");
            }
            break;

        case "sc":
            const scMsg = args.slice(1).join(" ");
            if (!scMsg) return;
            world.getAllPlayers().filter(p => p.hasTag("rank:admin") || p.hasTag("rank:mod")).forEach(p => p.sendMessage(`§b[STAFF] §7${player.name}: §f${scMsg}`));
            break;

        case "tp":
            if (!s.Teleport) return player.sendMessage("§cModule disabled.");
            const tpT = findTarget(args[1]);
            if (tpT) player.runCommand(`tp "${player.name}" "${tpT.name}"`);
            break;

        case "gm":
            if (!isAdmin || !s.Gamemode) return;
            const modes = { "0": "survival", "1": "creative", "2": "adventure", "3": "spectator" };
            if (modes[args[1]]) player.runCommand(`gamemode ${modes[args[1]]}`);
            break;

        case "invsee":
            const invT = findTarget(args[1]);
            if (!invT) return player.sendMessage("§cNot found.");
            player.sendMessage(`§b- - - ${invT.name}'s Inventory - - -`);
            const inv = invT.getComponent("inventory").container;
            for (let i = 0; i < inv.size; i++) {
                const item = inv.getItem(i);
                if (item) player.sendMessage(`§bx${item.amount} §f${item.typeId.split(":")[1].replace(/_/g, " ")}`);
            }
            const equip = invT.getComponent("equippable");
            ["Head", "Chest", "Legs", "Feet", "Offhand"].forEach(slot => {
                const item = equip.getEquipment(slot);
                if (item) player.sendMessage(`§b[${slot}] §f${item.typeId.split(":")[1].replace(/_/g, " ")}`);
            });
            break;

        case "punish":
            if (!s.Punishments) return;
            const pTarget = findTarget(args[1]);
            const pType = args[2];
            const reason = args.slice(3).join(" ") || "No reason";
            if (!pTarget) return;
            let h = pTarget.getDynamicProperty("history") || "CLEAN";
            if (h === "CLEAN") h = "";
            pTarget.setDynamicProperty("history", h + `${pType.toUpperCase()} - ${reason}\n`);
            if (pType === "warn") {
                let w = (pTarget.getDynamicProperty("warns") || 0) + 1;
                pTarget.setDynamicProperty("warns", w);
                world.sendMessage(`§b[Staff] §f${pTarget.name} warned (${w}/8).`);
                player.sendMessage(`§bSuccessfully warned ${pTarget.name}!`);
                if (w >= 8 && s.AutoBan) {
                    world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + 31536000000);
                    player.runCommand(`kick "${pTarget.name}" §c8 Warnings reached.`);
                }
            } else if (pType === "tempban") {
                const time = parseInt(args[3]) || 60;
                world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + (time * 60000));
                player.runCommand(`kick "${pTarget.name}" §cTemp-banned.`);
            } else if (pType === "shadowmute") pTarget.setDynamicProperty("shadowMute", true);
            else if (pType === "kick") player.runCommand(`kick "${pTarget.name}" ${reason}`);
            break;

        case "log":
            const vT = findTarget(args[1]);
            if (!vT) return;
            player.sendMessage(`§b--- ${vT.name}'s Logs ---\n§f${vT.getDynamicProperty("history") || "CLEAN"}`);
            break;

        case "pardon":
            if (!isAdmin) return;
            const parName = args[1];
            world.setDynamicProperty(`ban_${parName}`, 0);
            const parT = findTarget(parName);
            if (parT) {
                parT.setDynamicProperty("warns", 0);
                parT.setDynamicProperty("shadowMute", false);
                parT.setDynamicProperty("history", "CLEAN");
            }
            player.sendMessage(`§bCleared all data for ${parName}`);
            break;

        case "settings":
            if (!isAdmin) return;
            let sets = getSettings();
            const k = args[1];
            if (k && sets[k] !== undefined) sets[k] = !sets[k];
            saveSettings(sets);
            player.sendMessage("§b--- Settings System ---\n" + Object.entries(sets).map(([key, val]) => `§b${key}: ${val ? "§aON" : "§cOFF"}`).join("\n"));
            break;
    }
}

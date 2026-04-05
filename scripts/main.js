import { world, system } from "@minecraft/server";

const lastChat = new Map();

// --- HELPER: FIXED PARTIAL NAME MATCH ---
function findTarget(name) {
    if (!name) return undefined;
    const players = world.getAllPlayers();
    // Try exact match first, then partial
    return players.find(p => p.name.toLowerCase() === name.toLowerCase()) || 
           players.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
}

// --- SETTINGS SYSTEM ---
function getSettings() {
    const raw = world.getDynamicProperty("mod_settings");
    if (!raw) return { spam: true, joinMsg: true, autoBan: true };
    try { return JSON.parse(raw); } catch { return { spam: true, joinMsg: true, autoBan: true }; }
}

function saveSettings(obj) {
    world.setDynamicProperty("mod_settings", JSON.stringify(obj));
}

// --- JOIN MESSAGE ---
world.afterEvents.playerSpawn.subscribe((ev) => {
    const { player, initialSpawn } = ev;
    if (!initialSpawn) return;
    
    if (getSettings().joinMsg) {
        world.sendMessage(`§7[§a+§7] §f${player.name} §7has joined!`);
    }

    const banTime = world.getDynamicProperty(`ban_${player.name}`);
    if (banTime && Date.now() < banTime) {
        system.run(() => {
            const mins = Math.ceil((banTime - Date.now()) / 60000);
            player.runCommand(`kick "${player.name}" §cTemp-Banned. Time left: ${mins}m`);
        });
    }
});

// --- MAIN CHAT HANDLER ---
world.beforeEvents.chatSend.subscribe((ev) => {
    const player = ev.sender;
    const msg = ev.message;
    const settings = getSettings();

    // Shadow Mute Check
    if (player.getDynamicProperty("shadowMute")) {
        ev.cancel = true;
        system.run(() => player.sendMessage(`§f${player.name}: ${msg}`));
        return;
    }

    // Spam Check
    if (settings.spam && lastChat.has(player.id) && Date.now() - lastChat.get(player.id) < 1500) {
        ev.cancel = true;
        system.run(() => player.sendMessage("§cSlow down!"));
        return;
    }
    lastChat.set(player.id, Date.now());

    // Command Check
    if (msg.startsWith(".")) {
        ev.cancel = true;
        system.run(() => handleCommand(player, msg.slice(1).split(" ")));
        return;
    }

    // Chat Ranks
    ev.cancel = true;
    let prefix = player.hasTag("rank:admin") ? "§4[Admin]§r " : (player.hasTag("rank:mod") ? "§b[Mod]§r " : "§7[Member]§r ");
    let nameColor = player.hasTag("on_duty") ? "§a" : "§f";
    system.run(() => world.sendMessage(`${prefix}${nameColor}${player.name}§r: ${msg}`));
});

function handleCommand(player, args) {
    const cmd = args[0].toLowerCase();
    const isAdmin = player.hasTag("rank:admin");
    const isMod = player.hasTag("rank:mod");
    const isStaff = isAdmin || isMod;
    const onDuty = player.hasTag("on_duty");

    const validCmds = ["duty", "gm", "punish", "pardon", "sc", "tp", "view", "invsee", "settings"];
    
    // Error for invalid command
    if (!validCmds.includes(cmd)) {
        return player.sendMessage(`§cError: ".${cmd}" is not a command.`);
    }

    // Duty Check
    if (cmd !== "duty" && isStaff && !onDuty) {
        return player.sendMessage("§cYou must be .duty to use staff commands!");
    }

    switch (cmd) {
        case "duty":
            if (!isStaff) return;
            if (onDuty) {
                player.removeTag("on_duty");
                player.nameTag = player.name;
                player.sendMessage("§cShift Ended.");
            } else {
                player.addTag("on_duty");
                player.nameTag = `§a${player.name}`;
                player.sendMessage("§aShift Started!");
            }
            break;

        case "sc":
            const scMsg = args.slice(1).join(" ");
            if (!scMsg) return player.sendMessage("§cUsage: .sc [msg]");
            world.getAllPlayers().filter(p => p.hasTag("rank:admin") || p.hasTag("rank:mod")).forEach(p => {
                p.sendMessage(`§e[STAFF] §7${player.name}: §f${scMsg}`);
            });
            break;

        case "tp":
            const tpT = findTarget(args[1]);
            if (!tpT) return player.sendMessage("§cPlayer not found.");
            player.runCommand(`tp "${player.name}" "${tpT.name}"`);
            break;

        case "gm":
            if (!isAdmin) return;
            const modes = { "0": "survival", "1": "creative", "2": "adventure", "3": "spectator" };
            if (!modes[args[1]]) return player.sendMessage("§cUsage: .gm [0-3]");
            player.runCommand(`gamemode ${modes[args[1]]}`);
            break;

        case "invsee":
            const invT = findTarget(args[1]);
            if (!invT) return player.sendMessage("§cPlayer not found.");
            const container = invT.getComponent("inventory").container;
            player.sendMessage(`§e--- ${invT.name}'s Inv ---`);
            for (let i = 0; i < container.size; i++) {
                const item = container.getItem(i);
                if (item) player.sendMessage(`§7- §f${item.amount}x ${item.typeId.split(":")[1]} ${item.nameTag ? `(${item.nameTag})` : ""}`);
            }
            break;

        case "punish":
            const pTarget = findTarget(args[1]);
            const pType = args[2];
            const reason = args.slice(3).join(" ") || "No reason";
            if (!pTarget || !["warn", "kick", "ban", "mute", "shadowmute", "tempban"].includes(pType)) {
                return player.sendMessage("§cUsage: .punish [name] [type] [reason]");
            }

            let history = pTarget.getDynamicProperty("history") || "";
            pTarget.setDynamicProperty("history", history + `|${pType.toUpperCase()}:${reason}`);

            if (pType === "warn") {
                let w = (pTarget.getDynamicProperty("warns") || 0) + 1;
                pTarget.setDynamicProperty("warns", w);
                world.sendMessage(`§e[Staff] §f${pTarget.name} warned (${w}/8).`);
                if (w >= 8) {
                    world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + 31536000000);
                    player.runCommand(`kick "${pTarget.name}" §c8 Warnings reached.`);
                }
            } else if (pType === "tempban") {
                const time = parseInt(args[3]) || 60;
                world.setDynamicProperty(`ban_${pTarget.name}`, Date.now() + (time * 60000));
                player.runCommand(`kick "${pTarget.name}" §cTemp-banned: ${reason}`);
            } else if (pType === "shadowmute") {
                pTarget.setDynamicProperty("shadowMute", true);
            }
            break;

        case "view":
            const vT = findTarget(args[1]);
            if (!vT) return player.sendMessage("§cPlayer not found.");
            player.sendMessage(`§eLog for ${vT.name}: §f${vT.getDynamicProperty("history") || "Clean"}`);
            break;

        case "settings":
            if (!isAdmin) return;
            let sets = getSettings();
            if (args[1] === "spam") sets.spam = !sets.spam;
            if (args[1] === "join") sets.joinMsg = !sets.joinMsg;
            saveSettings(sets);
            player.sendMessage(`§aSettings updated: Spam=${sets.spam}, Join=${sets.joinMsg}`);
            break;
            
        case "pardon":
            if (!isAdmin) return;
            const parName = args[1];
            world.setDynamicProperty(`ban_${parName}`, 0);
            const parT = findTarget(parName);
            if (parT) {
                parT.setDynamicProperty("warns", 0);
                parT.setDynamicProperty("shadowMute", false);
            }
            player.sendMessage(`§aPardoned ${parName}`);
            break;
    }
}

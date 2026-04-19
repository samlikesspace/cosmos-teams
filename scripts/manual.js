import { world, system } from "@minecraft/server";

// --- Database Logic ---
function getTeams() {
    const raw = world.getDynamicProperty("cosmos_teams");
    return raw ? JSON.parse(raw) : {};
}

function saveTeams(teams) {
    world.setDynamicProperty("cosmos_teams", JSON.stringify(teams));
}

// --- Systems Tracking ---
const combatTimers = new Map(); // player name -> tick
const tpRequests = new Map();   // target name -> requester name

// --- Helpers ---
function findMemberInTeam(team, inputName) {
    if (!inputName) return null;
    return team.members.find(m => m.toLowerCase().includes(inputName.toLowerCase()));
}

function playSound(player, sound, pitch = 1) {
    player.runCommandAsync(`playsound ${sound} @s ~ ~ ~ 1 ${pitch}`);
}

function sendFullHelp(player) {
    player.sendMessage("§l§s--- Cosmos Teams Command List ---");
    player.sendMessage("§s.team §7- Shows the list of commands!");
    player.sendMessage("§s.team list §7- View all teams and its members");
    player.sendMessage("§s.team info {user} §7- View teammate coords/health");
    player.sendMessage("§s.team create {name} §7- Start your own team");
    player.sendMessage("§s.team request {team} §7- Request to join a team");
    player.sendMessage("§o§7You may only be apart of 1 team at a time.");
    player.sendMessage("§s.team leave §7- Leave your current team");
    player.sendMessage("§s.team disband §7- Delete your team §7[§sOwner+§7]");
    player.sendMessage("§s.team tp {user} §7- Request TP to teammate");
    player.sendMessage("§s.team tp accept §7- Accept a pending TP");
    player.sendMessage("§s.team kick {user} §7- Remove a team member §7[§sManager+§7]");
    player.sendMessage("§s.team manager {user} §7- Promote a member to Manager §7[§sOwner+§7]");
    player.sendMessage("§s.team transfer {user} §7- Change the Owner of the team §7[§sOwner+§7]");
    player.sendMessage("§s.team invites §7- List pending requests with IDs");
    player.sendMessage("§s.team accept/decline {id} §7- Manage join requests");
    player.sendMessage("§s.team home §7- Teleport to the team home");
    player.sendMessage("§s.team home set §7- Set home at current spot §7[§sOwner+§7]");
    player.sendMessage("§s.team chat §7- Toggle private team chat");
    player.sendMessage("§o§7v2.0 §r- samlikesspace.dev");
}

// --- Combat Events ---
world.afterEvents.entityHitEntity.subscribe((ev) => {
    if (ev.damagingEntity.typeId === "minecraft:player") {
        combatTimers.set(ev.damagingEntity.name, system.currentTick + 300); // 15s
    }
    if (ev.hitEntity.typeId === "minecraft:player") {
        combatTimers.set(ev.hitEntity.name, system.currentTick + 300);
    }
});

world.afterEvents.entityDie.subscribe((ev) => {
    if (ev.deadEntity.typeId === "minecraft:player") combatTimers.delete(ev.deadEntity.name);
    if (ev.damageSource.damagingEntity?.typeId === "minecraft:player") combatTimers.delete(ev.damageSource.damagingEntity.name);
});

// --- Join Notification ---
world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn) {
        ev.player.sendMessage("§7[§s§lCOSMOS TEAMS§r§7] §fNever used Cosmos Teams before? Type §s'.team'§f in chat!");
    }
});

// --- Chat Command Interceptor ---
world.beforeEvents.chatSend.subscribe((data) => {
    const { sender, message } = data;
    const teams = getTeams();
    const myTeamName = Object.keys(teams).find(n => teams[n].members.includes(sender.name));

    if (sender.hasTag("teamChat") && !message.startsWith(".")) {
        data.cancel = true;
        if (!myTeamName) { sender.removeTag("teamChat"); return; }
        const teamMembers = teams[myTeamName].members;
        world.getAllPlayers().filter(p => teamMembers.includes(p.name)).forEach(p => {
            p.sendMessage(`§7[§l§sTEAM§r§7] <§f${sender.name}> ${message}`);
        });
        return;
    }

    if (!message.startsWith(".team")) return;
    data.cancel = true;

    const args = message.split(" ");
    let cmd = args[1]?.toLowerCase();
    
    // Alias handling
    if (cmd === "h") cmd = "home";

    system.run(() => {
        // Combat Check
        if (combatTimers.has(sender.name) && system.currentTick < combatTimers.get(sender.name)) {
            playSound(sender, "note.bass", 0.5);
            return sender.sendMessage("§l§cx §r§fYou are in combat! Commands are locked.");
        }

        const team = teams[myTeamName];

        switch (cmd) {
            case "create":
                if (myTeamName) return sender.sendMessage("§l§cx §r§fYou are already in a team!");
                const name = args[2];
                if (!name) return sender.sendMessage("§l§cx §r§fUsage: .team create {name}");
                teams[name] = { 
                    owner: sender.name, 
                    managers: [sender.name], 
                    members: [sender.name], 
                    requests: [], // Format: {id: number, name: string}
                    home: null
                };
                saveTeams(teams);
                sender.sendMessage(`§l§a+ §r§f Team '${name}' created!`);
                break;

            case "info":
                if (!team) return sender.sendMessage("§l§cx §r§fYou have no team.");
                const infoUser = findMemberInTeam(team, args[2]);
                const infoP = world.getAllPlayers().find(p => p.name === infoUser);
                if (!infoP) return sender.sendMessage("§l§cx §r§fTeam member is offline.");
                sender.sendMessage(`§s--- ${infoUser} Info ---`);
                sender.sendMessage(`§fHealth: §a${Math.round(infoP.getComponent("health").currentValue)}`);
                sender.sendMessage(`§fCoords: §7${Math.floor(infoP.location.x)}, ${Math.floor(infoP.location.y)}, ${Math.floor(infoP.location.z)}`);
                break;

            case "list":
                sender.sendMessage("§s§l--- All Teams ---");
                for (const [n, t] of Object.entries(teams)) {
                    sender.sendMessage(`§e${n}: §f${t.members.join(", ")}`);
                }
                break;

            case "request":
                if (myTeamName) return sender.sendMessage("§l§cx §r§fYou must leave your team first.");
                const targetT = teams[args[2]];
                if (!targetT) return sender.sendMessage("§l§cx §r§f Team not found.");
                const reqId = Math.floor(1000 + Math.random() * 9000);
                targetT.requests.push({ id: reqId, name: sender.name });
                saveTeams(teams);
                sender.sendMessage(`§l§a+ §r§f Request sent! Your ID is §e${reqId}`);
                break;

            case "invites":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§l§cx §r§f Manager only.");
                sender.sendMessage("§l§s--- Pending Requests ---");
                if (team.requests.length === 0) sender.sendMessage("§7No pending requests.");
                team.requests.forEach(r => sender.sendMessage(`§eID: ${r.id} §f- ${r.name}`));
                break;

            case "accept":
            case "decline":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§l§cx §r§f You must be a manager");
                const idInput = parseInt(args[2]);
                const reqObj = team.requests.find(r => r.id === idInput);
                if (!reqObj) return sender.sendMessage("§l§cx §r§f Invalid Request ID.");
                
                if (cmd === "accept") team.members.push(reqObj.name);
                team.requests = team.requests.filter(r => r.id !== idInput);
                saveTeams(teams);
                sender.sendMessage(`§l§a+ §r§f ${cmd === "accept" ? "Accepted" : "Declined"} ${reqObj.name}.`);
                break;

            case "tp":
                if (!team) return sender.sendMessage("§l§cx §r§f You have no team.");
                if (args[2] === "accept") {
                    const reqName = tpRequests.get(sender.name);
                    if (!reqName) return sender.sendMessage("§l§cx §r§f No pending TP requests.");
                    const sourceP = world.getAllPlayers().find(p => p.name === reqName);
                    if (sourceP) {
                        sourceP.teleport(sender.location);
                        playSound(sourceP, "mob.enderman.portal");
                        sender.sendMessage(`§l§a+ §r§f Accepted TP from ${reqName}`);
                    }
                    tpRequests.delete(sender.name);
                    return;
                }
                const targetName = findMemberInTeam(team, args[2]);
                const pTarget = world.getAllPlayers().find(p => p.name === targetName);
                if (pTarget) {
                    tpRequests.set(pTarget.name, sender.name);
                    pTarget.sendMessage(`§s${sender.name} §frequests to TP. Type §s.team tp accept`);
                    sender.sendMessage(`§l§a+ §r§f Request sent to ${targetName}`);
                } else sender.sendMessage("§l§cx §r§f Player not online.");
                break;

            case "home":
                if (!team) return sender.sendMessage("§l§cx §r§f You have no team.");
                if (args[2] === "set") {
                    if (team.owner !== sender.name) return sender.sendMessage("§l§cx §r§f Owner only.");
                    team.home = { x: sender.location.x, y: sender.location.y, z: sender.location.z };
                    saveTeams(teams);
                    sender.sendMessage("§l§a+ §r§f Home saved!");
                } else {
                    if (!team.home) return sender.sendMessage("§l§cx §r§f Home not set.");
                    sender.sendMessage("§eTeleporting in 3s... Don't move!");
                    system.runTimeout(() => {
                        sender.teleport(team.home);
                        playSound(sender, "mob.enderman.portal");
                        sender.sendMessage("§l§a+§r§f Teleported to home.");
                    }, 60);
                }
                break;

            case "kick":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§l§cx§r§f You must be a manager");
                // Direct lookup in team object to support offline kicks
                const kickTarget = team.members.find(m => m.toLowerCase().includes(args[2]?.toLowerCase()));
                if (!kickTarget) return sender.sendMessage("§l§cx §r§f Member not found.");
                if (kickTarget === team.owner) return sender.sendMessage("§l§cx§r§f You can't kick the owner!");
                
                team.members = team.members.filter(m => m !== kickTarget);
                team.managers = team.managers.filter(m => m !== kickTarget);
                saveTeams(teams);
                sender.sendMessage(`§l§cx§r§f Kicked ${kickTarget}.`);
                break;

            case "manager":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§l§cx§r§f You must be the owner.");
                const manName = findMemberInTeam(team, args[2]);
                if (manName && !team.managers.includes(manName)) team.managers.push(manName);
                saveTeams(teams);
                sender.sendMessage(`§l§a+§r§f ${manName} is now a Manager.`);
                break;

            case "transfer":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§l§cx §r§f You must be the owner.");
                const newOwner = findMemberInTeam(team, args[2]);
                if (newOwner) {
                    team.owner = newOwner;
                    if (!team.managers.includes(newOwner)) team.managers.push(newOwner);
                    saveTeams(teams);
                    sender.sendMessage(`§l§a+ §r§f Transferred ownership to ${newOwner}.`);
                }
                break;

            case "chat":
                if (!myTeamName) return sender.sendMessage("§l§cx §r§f You have no team.");
                if (sender.hasTag("teamChat")) {
                    sender.removeTag("teamChat");
                    sender.sendMessage("§l§cx §r§f Team chat §l§cdeactivated.");
                } else {
                    sender.addTag("teamChat");
                    sender.sendMessage("§l§a+ §r§f Team chat §l§aactivated");
                }
                break;

            case "leave":
                if (!team) return;
                if (team.owner === sender.name) return sender.sendMessage("§l§cx §r§f Use '.team disband' as owner.");
                team.members = team.members.filter(m => m !== sender.name);
                team.managers = team.managers.filter(m => m !== sender.name);
                saveTeams(teams);
                sender.sendMessage("§l§cx §r§f You left the team.");
                break;

            case "disband":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§l§cx §r§f Owner only.");
                if (args[2] !== "confirm") return sender.sendMessage("§6§l! §r§f Type '.team disband confirm' to delete. §l§6This action is irriverable!");
                delete teams[myTeamName];
                saveTeams(teams);
                sender.sendMessage("§l§cx §r§f Team disbanded.");
                break;

            default:
                playSound(sender, "note.bass", 0.5);
                sendFullHelp(sender);
                break;
        }
    });
});

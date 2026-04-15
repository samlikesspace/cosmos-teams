import { world, system } from "@minecraft/server";

// --- Database Logic ---
function getTeams() {
    const raw = world.getDynamicProperty("cosmos_teams");
    return raw ? JSON.parse(raw) : {};
}

function saveTeams(teams) {
    world.setDynamicProperty("cosmos_teams", JSON.stringify(teams));
}

// --- Helper: Fuzzy Name & Player Search ---
function findMemberInTeam(team, inputName) {
    if (!inputName) return null;
    return team.members.find(m => m.toLowerCase().includes(inputName.toLowerCase()));
}

function sendFullHelp(player) {
    player.sendMessage("§l§s--- Cosmos Teams Command List ---");
    player.sendMessage("§s.team §7- Show this list (Note: You can only be in 1 team)");
    player.sendMessage("§s.team list §7- View all teams and members");
    player.sendMessage("§s.team create {name} §7- Start your own team");
    player.sendMessage("§s.team request {team} §7- Request to join a team");
    player.sendMessage("§s.team leave §7- Exit your current team");
    player.sendMessage("§s.team disband §7- Delete team (Owner only)");
    player.sendMessage("§s.team tp {user} §7- Teleport to teammate");
    player.sendMessage("§s.team kick {user} §7- Remove member (Manager+)");
    player.sendMessage("§s.team manager {user} §7- Promote to Manager (Owner only)");
    player.sendMessage("§s.team transfer {user} §7- Change Owner (Owner only)");
    player.sendMessage("§s.team invites §7- List pending requests");
    player.sendMessage("§s.team accept/decline {user} §7- Manage requests");
    player.sendMessage("§s.team home §7- TP to team home");
    player.sendMessage("§s.team home set §7- Set home at current spot (Owner)");
    player.sendMessage("§s.team chat §7- Toggle private team chat");
}

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

    // Team Chat Toggle Logic
    if (sender.hasTag("teamChat") && !message.startsWith(".")) {
        data.cancel = true;
        if (!myTeamName) {
            sender.removeTag("teamChat");
            return;
        }
        const teamMembers = teams[myTeamName].members;
        world.getAllPlayers().filter(p => teamMembers.includes(p.name)).forEach(p => {
            p.sendMessage(`§b[Team Chat] §f${sender.name}: ${message}`);
        });
        return;
    }

    if (!message.startsWith(".team")) return;
    data.cancel = true;

    const args = message.split(" ");
    const cmd = args[1]?.toLowerCase();

    system.run(() => {
        const team = teams[myTeamName];
        
        switch (cmd) {
            case "create":
                if (myTeamName) return sender.sendMessage("§cError: You are already in a team!");
                const name = args[2];
                if (!name) return sender.sendMessage("§cUsage: .team create {name}");
                teams[name] = { 
                    owner: sender.name, 
                    managers: [sender.name], 
                    members: [sender.name], 
                    requests: [], 
                    home: null,
                    settings: { tp: true, homes: true }
                };
                saveTeams(teams);
                sender.sendMessage(`§aSuccess: Team '${name}' created!`);
                break;

            case "list":
                sender.sendMessage("§b--- All Teams ---");
                for (const [n, t] of Object.entries(teams)) {
                    sender.sendMessage(`§e${n}: §f${t.members.join(", ")}`);
                }
                break;

            case "request":
                if (myTeamName) return sender.sendMessage("§cError: Leave your team first.");
                const targetT = teams[args[2]];
                if (!targetT) return sender.sendMessage("§cError: Team not found.");
                if (!targetT.requests.includes(sender.name)) targetT.requests.push(sender.name);
                saveTeams(teams);
                sender.sendMessage("§aRequest sent!");
                break;

            case "invites":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                sender.sendMessage(`§bPending Requests: §f${team.requests.join(", ") || "None"}`);
                break;

            case "accept":
            case "decline":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                const reqUser = findMemberInTeam({ members: team.requests }, args[2]);
                if (!reqUser) return sender.sendMessage("§cUser not found in requests.");
                if (cmd === "accept") team.members.push(reqUser);
                team.requests = team.requests.filter(r => r !== reqUser);
                saveTeams(teams);
                sender.sendMessage(`§a${cmd === "accept" ? "Accepted" : "Declined"} ${reqUser}.`);
                break;

            case "tp":
                if (!team) return sender.sendMessage("§cNo team.");
                if (!team.settings.tp) return sender.sendMessage("§cTeleporting is disabled for this team.");
                const tpTarget = findMemberInTeam(team, args[2]);
                const pTarget = world.getAllPlayers().find(p => p.name === tpTarget);
                if (pTarget) {
                    sender.teleport(pTarget.location);
                    sender.sendMessage(`§aTeleported to ${tpTarget}`);
                } else sender.sendMessage("§cPlayer not online.");
                break;

            case "home":
                if (!team) return sender.sendMessage("§cNo team.");
                if (args[2] === "set") {
                    if (team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                    team.home = { x: sender.location.x, y: sender.location.y, z: sender.location.z };
                    saveTeams(teams);
                    sender.sendMessage("§aHome location saved!");
                } else {
                    if (!team.home || !team.settings.homes) return sender.sendMessage("§cHome unavailable.");
                    sender.teleport(team.home);
                }
                break;

            case "kick":
                if (!team || !team.managers.includes(sender.name)) return sender.sendMessage("§cManager only.");
                const kickName = findMemberInTeam(team, args[2]);
                if (kickName === team.owner) return sender.sendMessage("§cCannot kick owner.");
                team.members = team.members.filter(m => m !== kickName);
                team.managers = team.managers.filter(m => m !== kickName);
                saveTeams(teams);
                sender.sendMessage(`§eKicked ${kickName}.`);
                break;

            case "manager":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                const manName = findMemberInTeam(team, args[2]);
                if (manName && !team.managers.includes(manName)) team.managers.push(manName);
                saveTeams(teams);
                sender.sendMessage(`§a${manName} is now a Manager.`);
                break;

            case "transfer":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                const newOwner = findMemberInTeam(team, args[2]);
                if (newOwner) {
                    team.owner = newOwner;
                    if (!team.managers.includes(newOwner)) team.managers.push(newOwner);
                    saveTeams(teams);
                    sender.sendMessage(`§aTransferred ownership to ${newOwner}.`);
                }
                break;

            case "settings":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                team.settings.tp = !team.settings.tp;
                team.settings.homes = !team.settings.homes;
                saveTeams(teams);
                sender.sendMessage(`§bTeam Features: TP(${team.settings.tp}), Homes(${team.settings.homes})`);
                break;

            case "chat":
                if (!myTeamName) return sender.sendMessage("§cNo team.");
                if (sender.hasTag("teamChat")) {
                    sender.removeTag("teamChat");
                    sender.sendMessage("§eTeam Chat: OFF");
                } else {
                    sender.addTag("teamChat");
                    sender.sendMessage("§bTeam Chat: ON");
                }
                break;

            case "leave":
                if (!team) return;
                if (team.owner === sender.name) return sender.sendMessage("§cUse '.team disband' to delete the team.");
                team.members = team.members.filter(m => m !== sender.name);
                team.managers = team.managers.filter(m => m !== sender.name);
                saveTeams(teams);
                sender.sendMessage("§eLeft team.");
                break;

            case "disband":
                if (!team || team.owner !== sender.name) return sender.sendMessage("§cOwner only.");
                if (args[2] !== "confirm") return sender.sendMessage("§6Type '.team disband confirm' to delete your team!");
                delete teams[myTeamName];
                saveTeams(teams);
                sender.sendMessage("§4Team disbanded.");
                break;

            default:
                sendFullHelp(sender);
                break;
        }
    });
});

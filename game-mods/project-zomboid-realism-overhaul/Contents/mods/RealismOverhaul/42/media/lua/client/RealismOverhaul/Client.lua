-- Realism Overhaul: client entry point. Presentation only.
-- The client never decides gameplay. It asks the server for its settings by
-- command name and displays what comes back.

require "RealismOverhaul/Config"
require "RealismOverhaul/Compat"
require "RealismOverhaul/CameraAdapter"

local Config, Compat = RealismOverhaul.Config, RealismOverhaul.Compat

local function onGameStart()
    print("[RealismOverhaul] " .. Config.VERSION .. " on " .. Compat.side() ..
        " · camera: " .. RealismOverhaul.CameraAdapter.status())
    if Compat.side() == "client" and type(sendClientCommand) == "function" then
        local player = type(getPlayer) == "function" and getPlayer() or nil
        if player then sendClientCommand(player, Config.COMMAND_MODULE, "requestSettings", {}) end
    end
end

-- Settings from the server replace local ones; nothing is merged from the client.
local function onServerCommand(module, command, args)
    if module ~= Config.COMMAND_MODULE or command ~= "settings" or type(args) ~= "table" then return end
    RealismOverhaul.serverSettings = args
end

if Compat.hasEvent("OnGameStart") then Events.OnGameStart.Add(onGameStart) end
if Compat.hasEvent("OnServerCommand") then Events.OnServerCommand.Add(onServerCommand) end

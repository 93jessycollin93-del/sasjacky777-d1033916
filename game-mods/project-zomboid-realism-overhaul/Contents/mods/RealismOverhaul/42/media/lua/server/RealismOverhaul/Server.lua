-- Realism Overhaul: server authority.
-- Clients may only send allowlisted command names. Their args are ignored: the
-- server answers with its own sandbox settings, never with values a client sent.

require "RealismOverhaul/Config"
require "RealismOverhaul/Compat"

local Config, Compat = RealismOverhaul.Config, RealismOverhaul.Compat

local ALLOWED = { requestSettings = true }

local function onClientCommand(module, command, player, _args)
    if module ~= Config.COMMAND_MODULE then return end
    if not ALLOWED[command] then
        print("[RealismOverhaul] refused unknown client command: " .. tostring(command))
        return
    end
    if command == "requestSettings" and type(sendServerCommand) == "function" then
        sendServerCommand(player, Config.COMMAND_MODULE, "settings", Config.snapshot())
    end
end

if Compat.hasEvent("OnClientCommand") then Events.OnClientCommand.Add(onClientCommand) end

-- Realism Overhaul: configuration and feature toggles.
-- Every realism feature starts OFF. A toggle is read from the server's sandbox
-- options when they exist, so in multiplayer the server decides, never a client.

RealismOverhaul = RealismOverhaul or {}

local Config = {
    VERSION = "0.1.0",
    TARGET_BUILD = "42.21.0",
    COMMAND_MODULE = "RealismOverhaul",
    defaults = {
        EnableMovement = false,
        EnableLighting = false,
        EnableAudio = false,
        EnableCameraAdapter = true,
    },
}

-- Reads one toggle. Unknown names return false rather than guessing.
function Config.get(name)
    if Config.defaults[name] == nil then return false end
    local vars = SandboxVars
    if type(vars) == "table" and type(vars.RealismOverhaul) == "table" then
        local v = vars.RealismOverhaul[name]
        if type(v) == "boolean" then return v end
    end
    return Config.defaults[name]
end

function Config.snapshot()
    local out = {}
    for name, _ in pairs(Config.defaults) do out[name] = Config.get(name) end
    return out
end

RealismOverhaul.Config = Config
return Config

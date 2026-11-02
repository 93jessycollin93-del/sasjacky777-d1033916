-- Realism Overhaul: feature detection.
-- Build 42 is still changing between point releases, so nothing here assumes an
-- API exists. Each probe is wrapped in pcall and answers false when unsure.

RealismOverhaul = RealismOverhaul or {}

local Compat = {}

local function safe(fn, ...)
    if type(fn) ~= "function" then return false, nil end
    local ok, result = pcall(fn, ...)
    if not ok then return false, nil end
    return true, result
end

-- True when a mod id is in the active list. Used only to detect pz3d; we never
-- call into pz3d, because its internals are not a documented API.
function Compat.isModActive(modId)
    local ok, mods = safe(getActivatedMods)
    if not ok or mods == nil then return false end
    local ok2, has = pcall(function() return mods:contains(modId) end)
    return ok2 and has == true
end

function Compat.hasPz3d()
    return Compat.isModActive("pz3d")
end

function Compat.side()
    local okC, client = safe(isClient)
    local okS, server = safe(isServer)
    if okS and server then return "server" end
    if okC and client then return "client" end
    return "singleplayer"
end

function Compat.hasEvent(name)
    return type(Events) == "table" and type(Events[name]) == "table" and type(Events[name].Add) == "function"
end

RealismOverhaul.Compat = Compat
return Compat

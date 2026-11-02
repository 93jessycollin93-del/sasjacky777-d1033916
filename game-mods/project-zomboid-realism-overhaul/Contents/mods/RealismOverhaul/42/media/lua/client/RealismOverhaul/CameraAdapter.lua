-- Realism Overhaul: first-person camera adapter boundary.
--
-- Build 42 exposes no supported Lua API for a first-person camera. This adapter
-- does NOT fake one. It reports one of three states and nothing more:
--   "disabled"   the toggle is off
--   "delegated"  pz3d is active; pz3d owns the camera, we do not touch it
--   "blocked"    pz3d is absent; first person is unavailable
-- Any future integration goes through Adapter.attach(provider), with a provider
-- that implements the documented calls of a real dependency.

require "RealismOverhaul/Config"
require "RealismOverhaul/Compat"

local Adapter = { provider = nil }

function Adapter.status()
    local Config, Compat = RealismOverhaul.Config, RealismOverhaul.Compat
    if not Config.get("EnableCameraAdapter") then return "disabled" end
    if Adapter.provider ~= nil then return "attached" end
    if Compat.hasPz3d() then return "delegated" end
    return "blocked"
end

-- A provider must expose isAvailable(); anything else is refused.
function Adapter.attach(provider)
    if type(provider) ~= "table" or type(provider.isAvailable) ~= "function" then return false end
    local ok, available = pcall(provider.isAvailable)
    if not ok or available ~= true then return false end
    Adapter.provider = provider
    return true
end

RealismOverhaul.CameraAdapter = Adapter
return Adapter

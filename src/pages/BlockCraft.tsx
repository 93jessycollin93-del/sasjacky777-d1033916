import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { configureEdition, GAME_NAME, GAME_SHORT } from "@/craft/edition";
import { CraftApp } from "@/craft/ui/CraftApp";

// Inside the app the game has what the solo copy lacks: the signed-in
// Supabase client behind online rooms and cloud saves, and somewhere to go
// back to. An https page may not dial ws:// on the LAN, so that link is off.
configureEdition({
  kind: "sas-jacky",
  tagline: `${GAME_SHORT} · SAS-JACKY EDITION`,
  exitLabel: "Back to Jackie",
  online: supabase,
  cloud: true,
  lanJoin: false,
  lanHost: null,
  device: true,
});

/**
 * CollinSurvivalCraft — the block-building survival game, full screen over
 * the app. Everything it draws is painted by code in src/craft, so it needs
 * no asset downloads and works offline once the page has loaded. The same
 * game ships on its own from csc/.
 */
export default function BlockCraft() {
  const navigate = useNavigate();
  useEffect(() => {
    const before = document.title;
    document.title = `${GAME_NAME} · SAS-JACKY`;
    return () => { document.title = before; };
  }, []);
  return <CraftApp onExit={() => navigate("/")} />;
}

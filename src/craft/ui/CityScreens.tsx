/**
 * The city's shop screens: the Bullet Bazaar's counter and the Yeet Motors
 * sales desk (engine/shops.ts has the stock). Cash comes out of the buyer's
 * own wallet and the goods go into their own pockets; a car is delivered to
 * the kerb beside them.
 */
import { useState } from "react";
import type { Game } from "../game/game";
import { CAR_COLORS, CAR_MODELS, type CarModelId } from "../engine/cars";
import { itemByName } from "../engine/items";
import { carPrice, DEALER_MODELS, GUN_SHOP, type ShopItem, type ShopKind } from "../engine/shops";
import { Button } from "./common";

const u = (n: number) => `calc(var(--u) * ${n})`;
/** A shop card: name and price across the top, the patter under them. */
const CARD = { padding: u(4), textAlign: "left", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", gap: u(1.5), height: "auto" } as const;
const money = (n: number) => `$${Math.floor(n).toLocaleString("en-US")}`;

const SOLD = ["Pleasure doing business.", "No refunds. No questions.", "Stonks.", "Enjoy responsibly. Or don't, I'm a sign.", "Receipt? Never heard of her."];
const BROKE = ["You're broke, fam.", "Card declined. Skill issue.", "Come back with more cash, or less ambition.", "Not stonks."];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

export function ShopScreen({ game, which }: { game: Game; which: ShopKind }) {
  const [line, setLine] = useState<string>(which === "guns" ? "Welcome to the Bullet Bazaar. Everything's legal if you don't ask." : "Yeet Motors: drive it like you stole it. Please pay first.");
  const [, bump] = useState(0);
  const [colour, setColour] = useState(0);
  const cash = game.player.cash;

  const pay = (price: number): boolean => {
    if (game.player.cash < price) { setLine(pick(BROKE)); game.sound("lose", null, 0, 0, 0.4, 1.3); return false; }
    game.player.cash -= price;
    game.sound("cashout", null, 0, 0, 0.8);
    game.bumpInv();
    bump((n) => n + 1);
    return true;
  };

  const buy = (s: ShopItem) => {
    if (!pay(s.price)) return;
    const p = game.player;
    for (const [name, count] of s.items) {
      let id: number;
      try { id = itemByName(name).id; } catch { continue; }
      const left = p.inventory.add({ id, count });
      if (left > 0) game.dropItem(p.body.x, p.body.y + 1, p.body.z, { id, count: left });
    }
    game.bumpInv();
    setLine(`${s.name}: ${pick(SOLD)}`);
  };

  const buyCar = (model: CarModelId) => {
    if (!pay(carPrice(model))) return;
    game.deliverCar(model, CAR_MODELS[model].livery ?? colour);
    setLine(`Your ${CAR_MODELS[model].name} is out front. ${pick(SOLD)}`);
  };

  return (
    <div className="absolute inset-0 pointer-events-auto bc-shadow" data-testid="shop-screen"
      style={{ background: "rgba(8,6,18,0.84)", overflowY: "auto", padding: u(5), display: "flex", justifyContent: "center" }}>
      <div style={{ width: `min(100%, calc(var(--u) * 300))`, display: "flex", flexDirection: "column", gap: u(4) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: u(3) }}>
          <div style={{ fontSize: u(10), color: which === "guns" ? "#ff5a4a" : "#5ad8ff", textShadow: `0 0 calc(var(--u) * 5) ${which === "guns" ? "#ff2a1a" : "#2a9aff"}` }}>
            {which === "guns" ? "BULLET BAZAAR" : "YEET MOTORS"}
          </div>
          <div data-testid="shop-cash" style={{ fontSize: u(9), color: "#7aff9a", fontFamily: "monospace" }}>{money(cash)}</div>
        </div>
        <div data-testid="shop-line" style={{ fontSize: u(6.5), color: "#ffe070", textAlign: "center" }}>{line}</div>
        {which === "guns" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 120), 1fr))", gap: u(3) }}>
            {GUN_SHOP.map((s) => (
              <button key={s.id} type="button" className="bc-btn" data-testid={`buy-${s.id}`} onClick={() => buy(s)} disabled={cash < s.price}
                style={{ ...CARD, opacity: cash < s.price ? 0.55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: u(2) }}>
                  <span style={{ fontSize: u(6), color: "#ffffff" }}>{s.name}</span>
                  <span style={{ fontSize: u(6), color: "#7aff9a", fontFamily: "monospace", whiteSpace: "nowrap" }}>{money(s.price)}</span>
                </div>
                <div className="bc-sub" style={{ lineHeight: 1.4 }}>{s.blurb}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: u(1.5), flexWrap: "wrap", justifyContent: "center" }}>
              {CAR_COLORS.map((c, i) => (
                <button key={c} type="button" data-testid={`paint-${i}`} onClick={() => setColour(i)} aria-label={`Paint ${i + 1}`}
                  style={{ width: u(9), height: u(9), background: c, border: i === colour ? `${u(1)} solid #ffffff` : `${u(0.5)} solid #00000080`, cursor: "pointer" }} />
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 120), 1fr))", gap: u(3) }}>
              {DEALER_MODELS.map((m) => {
                const spec = CAR_MODELS[m];
                return (
                  <button key={m} type="button" className="bc-btn" data-testid={`buy-car-${m}`} onClick={() => buyCar(m)} disabled={cash < spec.price}
                    style={{ ...CARD, opacity: cash < spec.price ? 0.55 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: u(2) }}>
                      <span style={{ fontSize: u(6), color: "#ffffff" }}>{spec.name}</span>
                      <span style={{ fontSize: u(6), color: "#7aff9a", fontFamily: "monospace", whiteSpace: "nowrap" }}>{money(spec.price)}</span>
                    </div>
                    <div className="bc-sub" style={{ lineHeight: 1.4 }}>{spec.blurb}</div>
                    <div className="bc-sub" style={{ color: "#9ad8ff" }}>Top speed {Math.round(spec.top * 72)} km/h{spec.livery !== undefined ? " · comes in its own colours" : ""}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <Button onClick={() => game.setScreen(null)}><span data-testid="shop-leave">Leave</span></Button>
      </div>
    </div>
  );
}

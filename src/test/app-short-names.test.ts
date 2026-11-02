import { describe, expect, it } from "vitest";
import { allApps, shortAppName } from "@/lib/appShortNames";

describe("SANDi's all-apps names", () => {
  it("keeps one- and two-word names as written", () => {
    expect(shortAppName("Repair Bay")).toBe("Repair Bay");
    expect(shortAppName("Workstation (the whole system, one flow)")).toBe("Workstation");
  });

  it("turns three or more words into initials", () => {
    expect(shortAppName("Project Zomboid: Realism Overhaul")).toBe("PZRO");
    expect(shortAppName("Eru · AdminEconomyDashboard")).toBe("Eru·AED");
  });

  it("lists every app once, with no alias duplicate like a second Workstation", () => {
    const apps = allApps();
    expect(apps.filter((a) => a.name === "Workstation")).toHaveLength(1);
    expect(apps.some((a) => a.path === "/work")).toBe(false);
  });

  it("never gives two apps the same short name", () => {
    const shorts = allApps().map((a) => a.short.toLowerCase());
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it("separates colliding initials with letters of the last word", () => {
    const apps = allApps([
      { path: "/a", label: "Activity Audit Log", group: "ops" },
      { path: "/b", label: "Admin Account List", group: "ops" },
    ]);
    expect(apps.map((a) => a.short)).toEqual(["AAL", "AALi"]);
  });
});

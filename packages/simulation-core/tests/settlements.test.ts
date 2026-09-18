import { describe, expect, it } from "vitest";
import { cellAt, runSimulation } from "../src/index";
import { canFoundSettlement, foundSettlement } from "../src/settlements";
import { bandOf, contextWithCommunities, world } from "./helpers";

describe("insediamenti", () => {
  it("una tribù fonda un insediamento quando le condizioni sono soddisfatte", () => {
    const state = world("fondazione");
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const band = bandOf(ctx, tribe.id);
    const cell = cellAt(state, tribe.x, tribe.y);
    cell.habitability = 0.8;

    tribe.techs = ["stone_tools", "agriculture"];
    tribe.yearsAtLocation = 1;
    band.foodRatio = 1;
    tribe.stock.food = 100;
    // Not yet: the band has not stayed long enough.
    expect(canFoundSettlement(ctx, band)).toBe(band.members.length >= 25 && false);

    tribe.yearsAtLocation = 10;
    while (band.members.length < 25)
      band.members.push({ ...band.members[0]!, id: `x${band.members.length}` });
    expect(canFoundSettlement(ctx, band)).toBe(true);

    const s = foundSettlement(ctx, band);
    expect(s.tribeId).toBe(tribe.id);
    expect(s.buildings.camp).toBe(1);
    expect(tribe.status).toBe("settled");
    expect(band.members.every((p) => p.settlementId === s.id)).toBe(true);
    expect(ctx.events.some((e) => e.type === "settlement_founded")).toBe(true);
  });

  it("senza agricoltura né sito ricco la tribù resta nomade", () => {
    const state = world("nomadi");
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const band = bandOf(ctx, tribe.id);
    const cell = cellAt(state, tribe.x, tribe.y);
    cell.river = false;
    cell.coastal = false;
    tribe.techs = [];
    tribe.yearsAtLocation = 20;
    tribe.stock.food = 100;
    band.foodRatio = 1;
    expect(canFoundSettlement(ctx, band)).toBe(false);
  });

  it("nel corso della simulazione nascono insediamenti con edifici e produzione", () => {
    const state = world("genesis");
    runSimulation(state, 400);
    const all = state.settlements;
    expect(all.length).toBeGreaterThan(0);
    const built = all.some((s) => s.buildings.hut > 0 || s.buildings.farm > 0 || s.buildings.storehouse > 0);
    expect(built).toBe(true);
  });
});

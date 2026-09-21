import { describe, expect, it } from "vitest";
import {
  TECH_BY_ID,
  TECH_VARIANTS,
  createWorld,
  localTechName,
  runSimulation,
  tribeEffects,
  variantByKey,
  variantFor,
  type Cell,
} from "../src/index";
import { grantTech, loseTech } from "../src/technology";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

function land(state: ReturnType<typeof world>, patch: Partial<Cell>): Cell[] {
  return state.cells
    .filter((c) => c.biome !== "ocean")
    .slice(0, 20)
    .map((c) => ({
      ...c,
      river: false,
      coastal: false,
      biome: "plains" as const,
      temperature: 0.6,
      moisture: 0.6,
      baseFertility: 0.4,
      clay: 0,
      ...patch,
    }));
}

describe("catalogo delle varianti", () => {
  it("ogni variante appartiene a una tecnica esistente e ha nome, descrizione e causa", () => {
    const keys = new Set<string>();
    for (const variant of TECH_VARIANTS) {
      expect(TECH_BY_ID.has(variant.techId), variant.key).toBe(true);
      expect(variant.name).toBeTruthy();
      expect(variant.description).toBeTruthy();
      expect(variant.cause).toBeTruthy();
      expect(keys.has(variant.key)).toBe(false);
      keys.add(variant.key);
      // Small adjustments: one multiplier, never beyond +12% or -5%.
      const entries = Object.entries(variant.effects);
      expect(entries).toHaveLength(1);
      for (const [, value] of entries) {
        expect(value).toBeGreaterThanOrEqual(0.95);
        expect(value).toBeLessThanOrEqual(1.12);
      }
    }
  });

  it("si ritrova per chiave, e una chiave sconosciuta non inventa nulla", () => {
    expect(variantByKey("agriculture.flood")?.techId).toBe("agriculture");
    expect(variantByKey("inesistente")).toBeNull();
    expect(variantByKey(undefined)).toBeNull();
  });
});

describe("la terra decide la forma", () => {
  it("un fiume fertile dà la coltura delle piene, le colline le terrazze, la pianura nulla", () => {
    const state = world("varianti");
    const tribe = state.tribes[0]!;
    expect(variantFor("agriculture", land(state, { river: true, baseFertility: 0.7 }), tribe)?.key).toBe(
      "agriculture.flood",
    );
    expect(variantFor("agriculture", land(state, { biome: "hills" }), tribe)?.key).toBe(
      "agriculture.terraces",
    );
    expect(variantFor("agriculture", land(state, {}), tribe)).toBeNull();
  });

  it("la stessa terra dà la stessa forma a popoli con identità diverse", () => {
    const state = createWorld({
      seed: "varianti-identita",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["egyptian", "roman"] },
    });
    const coast = land(state as never, { coastal: true });
    const [a, b] = state.tribes;
    expect(variantFor("fishing", coast, a!)?.key).toBe("fishing.deep");
    expect(variantFor("fishing", coast, b!)?.key).toBe("fishing.deep");
  });
});

describe("effetti e ciclo di vita", () => {
  it("l'effetto della variante si somma a quello della tecnica e scala con l'adozione", () => {
    const state = world("effetti-varianti");
    const tribe = state.tribes[0]!;
    tribe.techs = ["stone_tools", "agriculture"];
    tribe.techAdoption = { stone_tools: 1, agriculture: 1 };
    const gainAt = (adoption: number) => {
      tribe.techAdoption.agriculture = adoption;
      tribe.techVariants = {};
      const plain = tribeEffects(tribe).farmMultiplier;
      tribe.techVariants = { agriculture: "agriculture.flood" };
      return tribeEffects(tribe).farmMultiplier - plain;
    };
    // The local form helps, and helps less while the technique is barely in use.
    expect(gainAt(1)).toBeGreaterThan(0);
    expect(gainAt(0.2)).toBeGreaterThan(0);
    expect(gainAt(0.2)).toBeLessThan(gainAt(1));
  });

  it("chi perde una tecnica ne perde anche la forma locale", () => {
    const state = world("perdita-variante");
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    grantTech(ctx, tribe, "fire", "invention");
    grantTech(ctx, tribe, "food_preservation", "invention");
    tribe.techVariants.food_preservation = "clothing.furs";
    loseTech(ctx, tribe, TECH_BY_ID.get("food_preservation")!, 1, {
      tribe,
      population: 1,
      settled: false,
      settlements: 0,
      maxSettlementLevel: 0,
      area: [],
      maxHostility: 0,
      conflictMemory: 0,
    });
    expect(tribe.techVariants.food_preservation).toBeUndefined();
  });

  it("il nome locale sostituisce quello del catalogo solo se c'è una variante", () => {
    expect(
      localTechName({ techVariants: { agriculture: "agriculture.flood" } }, "agriculture", "Agricoltura"),
    ).toBe("Coltura delle Piene");
    expect(localTechName({ techVariants: {} }, "agriculture", "Agricoltura")).toBe("Agricoltura");
  });
});

describe("varianti in simulazione", () => {
  it("compaiono, appartengono a tecniche possedute e il testo concorda", () => {
    const state = createWorld({ seed: "varianti-mondo", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    let practised = 0;
    for (const tribe of state.tribes) {
      for (const [techId, key] of Object.entries(tribe.techVariants)) {
        // Never a local form of something the people does not have.
        expect(tribe.techs).toContain(techId);
        expect(variantByKey(key)?.techId).toBe(techId);
        practised++;
      }
    }
    expect(practised).toBeGreaterThan(0);
    for (const e of result.events.filter((x) => x.metadata.variant)) {
      const variant = variantByKey(String(e.metadata.variant))!;
      expect(e.description).toContain(variant.name);
      expect(e.description).not.toMatch(/\\b(della|dello) (Pellicce|Canali|Carri)/);
    }
  });
});

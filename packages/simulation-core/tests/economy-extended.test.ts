import { describe, expect, it } from "vitest";
import { consume, produce, storageCapacity } from "../src/economy";
import {
  addResource,
  bundleTotal,
  clampResource,
  computeSeasons,
  consumeResource,
  createWorld,
  emptyStock,
  getResourceAmount,
  hasRequiredResources,
  missingResources,
  normalizeStock,
  runSimulation,
  stockValue,
  techEffects,
  transferResource,
} from "../src/index";
import { bandOf, contextWithCommunities, world } from "./helpers";

describe("modello delle risorse", () => {
  it("gli helper non producono mai valori negativi o NaN", () => {
    const stock = emptyStock();
    addResource(stock, "food", 10);
    addResource(stock, "tin", 5);
    expect(getResourceAmount(stock, "food")).toBe(10);
    expect(getResourceAmount(stock, "tin")).toBe(5);
    expect(getResourceAmount(stock, "iron")).toBe(0);

    expect(consumeResource(stock, "food", 100)).toBe(10);
    expect(getResourceAmount(stock, "food")).toBe(0);
    expect(consumeResource(stock, "food", 5)).toBe(0);

    addResource(stock, "wood", Number.NaN);
    expect(getResourceAmount(stock, "wood")).toBe(0);
    addResource(stock, "wood", -50);
    expect(getResourceAmount(stock, "wood")).toBe(0);

    const other = emptyStock();
    expect(transferResource(stock, other, "tin", 3)).toBe(3);
    expect(getResourceAmount(other, "tin")).toBe(3);
    expect(getResourceAmount(stock, "tin")).toBe(2);

    addResource(other, "stone", 100);
    expect(clampResource(other, "stone", 40)).toBe(60);
    expect(getResourceAmount(other, "stone")).toBe(40);
  });

  it("i bundle esprimono requisiti verificabili", () => {
    const stock = emptyStock();
    addResource(stock, "wood", 10);
    expect(hasRequiredResources(stock, { wood: 10 })).toBe(true);
    expect(hasRequiredResources(stock, { wood: 10, stone: 5 })).toBe(false);
    expect(missingResources(stock, { wood: 10, stone: 5 })).toEqual({ stone: 5 });
    expect(bundleTotal({ wood: 10, stone: 5 })).toBe(15);
    expect(stockValue(stock)).toBeGreaterThan(0);
  });

  it("normalizza scorte provenienti da uno schema più vecchio", () => {
    const legacy = { food: 5, wood: 3, stone: 1, copper: 0 } as never;
    const stock = normalizeStock(legacy);
    expect(stock.goods).toEqual({});
    expect(stock.food).toBe(5);
    expect(getResourceAmount(stock, "clay")).toBe(0);
  });
});

describe("economia estesa", () => {
  it("la stagione modifica la produzione della stessa comunità", () => {
    const warm = world("stagione-calda");
    const cold = world("stagione-calda");
    // Same world, same workers: only the seasonal signal differs.
    for (const state of [warm, cold]) {
      const ctx = contextWithCommunities(state);
      const band = bandOf(ctx, state.tribes[0]!.id);
      for (const p of band.members) p.action = p.age >= 16 ? "gather" : "rest";
    }
    warm.climate.seasons = computeSeasons(warm, false);
    cold.climate.modifier = 0.6;
    cold.climate.seasons = computeSeasons(cold, true);

    const warmCtx = contextWithCommunities(warm);
    const coldCtx = contextWithCommunities(cold);
    const warmBand = bandOf(warmCtx, warm.tribes[0]!.id);
    const coldBand = bandOf(coldCtx, cold.tribes[0]!.id);
    for (const p of warmBand.members) p.action = p.age >= 16 ? "gather" : "rest";
    for (const p of coldBand.members) p.action = p.age >= 16 ? "gather" : "rest";
    const warmFood = produce(warmCtx, warmBand, techEffects([])).food;
    const coldFood = produce(coldCtx, coldBand, techEffects([])).food;
    expect(coldFood).toBeLessThan(warmFood);
  });

  it("l'inverno aumenta il fabbisogno di cibo", () => {
    const state = world("fabbisogno");
    const ctx = contextWithCommunities(state);
    const band = bandOf(ctx, state.tribes[0]!.id);
    band.stock.food = 10_000;
    const mild = consume(ctx, band, techEffects([]));

    const harsh = world("fabbisogno");
    harsh.climate.harshWinter = true;
    harsh.climate.seasons = computeSeasons(harsh, true);
    const harshCtx = contextWithCommunities(harsh);
    const harshBand = bandOf(harshCtx, harsh.tribes[0]!.id);
    harshBand.stock.food = 10_000;
    const cold = consume(harshCtx, harshBand, techEffects([]));
    expect(cold.needed).toBeGreaterThan(mild.needed);
    expect(cold.winterSurcharge).toBeGreaterThan(0);
  });

  it("il cibo deperisce e il magazzino limita le scorte", () => {
    const state = world("deperimento");
    const ctx = contextWithCommunities(state);
    const band = bandOf(ctx, state.tribes[0]!.id);
    band.stock.food = 10_000;
    const effects = techEffects([]);
    const capacity = storageCapacity(band, effects);
    consume(ctx, band, effects);
    expect(band.stock.food).toBeLessThanOrEqual(capacity + 0.01);

    // Preservation technologies reduce waste and raise capacity.
    const better = techEffects(["pottery", "food_preservation"]);
    expect(better.spoilageMultiplier).toBeLessThan(effects.spoilageMultiplier);
    expect(storageCapacity(band, better)).toBeGreaterThan(capacity);
  });

  it("la ceramica migliora la resilienza tra un anno e l'altro", () => {
    const state = world("ceramica");
    const plain = contextWithCommunities(state);
    const bandPlain = bandOf(plain, state.tribes[0]!.id);
    bandPlain.stock.food = 500;
    consume(plain, bandPlain, techEffects([]));
    const leftPlain = bandPlain.stock.food;

    const other = world("ceramica");
    const ctx = contextWithCommunities(other);
    const band = bandOf(ctx, other.tribes[0]!.id);
    band.stock.food = 500;
    consume(ctx, band, techEffects(["pottery", "agriculture", "fire"]));
    expect(band.stock.food).toBeGreaterThan(leftPlain);
  });

  it("gli strumenti si consumano e la produzione dipende dai lavoratori", () => {
    const state = world("strumenti");
    const ctx = contextWithCommunities(state);
    const band = bandOf(ctx, state.tribes[0]!.id);
    addResource(band.stock, "tools", 50);
    for (const p of band.members) p.action = p.age >= 16 ? "gather" : "rest";
    const withTools = produce(ctx, band, techEffects([])).food;

    const bare = contextWithCommunities(world("strumenti"));
    const bareBand = bandOf(bare, bare.state.tribes[0]!.id);
    for (const p of bareBand.members) p.action = p.age >= 16 ? "gather" : "rest";
    const withoutTools = produce(bare, bareBand, techEffects([])).food;
    expect(withTools).toBeGreaterThan(withoutTools);

    band.stock.food = 10_000;
    const before = getResourceAmount(band.stock, "tools");
    consume(ctx, band, techEffects([]));
    expect(getResourceAmount(band.stock, "tools")).toBeLessThan(before);
  });

  it("le metriche economiche sono coerenti lungo 150 anni", () => {
    const state = createWorld({ seed: "metriche-economiche" });
    const result = runSimulation(state, 150);
    for (const s of result.stats) {
      expect(s.foodProduced).toBeGreaterThanOrEqual(0);
      expect(s.foodConsumed).toBeGreaterThanOrEqual(0);
      expect(s.foodStored).toBeGreaterThanOrEqual(0);
      expect(s.wealth).toBeGreaterThanOrEqual(0);
      expect(s.goodsProduced).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.foodSurplus)).toBe(true);
      expect(s.storageCapacity).toBeGreaterThanOrEqual(0);
    }
  });
});

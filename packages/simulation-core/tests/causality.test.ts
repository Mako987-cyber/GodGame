import { describe, expect, it } from "vitest";
import {
  MAX_ANCHORS,
  anchor,
  anchored,
  causesFrom,
  createWorld,
  releaseAnchor,
  runSimulation,
  warKey,
} from "../src/index";
import { world } from "./helpers";

describe("ancoraggi causali", () => {
  it("un evento soppresso (senza id) non viene ricordato", () => {
    const tribe = world("ancore-vuote").tribes[0]!;
    anchor(tribe, "famine", { id: "", year: 0 });
    expect(anchored(tribe, "famine", 0)).toBeNull();
  });

  it("un ancoraggio troppo vecchio non è più una causa plausibile", () => {
    const tribe = world("ancore-eta").tribes[0]!;
    anchor(tribe, "famine", { id: "e5", year: -9000 });
    expect(anchored(tribe, "famine", -8995, 10)).toBe("e5");
    expect(anchored(tribe, "famine", -8980, 10)).toBeNull();
  });

  it("sono limitati: oltre il massimo escono i più vecchi, in modo deterministico", () => {
    const tribe = world("ancore-limite").tribes[0]!;
    for (let i = 0; i < MAX_ANCHORS + 10; i++) anchor(tribe, `war:t${i}`, { id: `e${i}`, year: i });
    expect(Object.keys(tribe.causalAnchors)).toHaveLength(MAX_ANCHORS);
    expect(anchored(tribe, "war:t0", MAX_ANCHORS + 10)).toBeNull();
    expect(anchored(tribe, `war:t${MAX_ANCHORS + 9}`, MAX_ANCHORS + 10)).toBe(`e${MAX_ANCHORS + 9}`);
  });

  it("le cause arrivano nell'ordine chiesto, senza doppioni", () => {
    const [a, b] = world("ancore-ordine").tribes;
    anchor(a!, warKey(b!.id), { id: "e10", year: 0 });
    anchor(b!, warKey(a!.id), { id: "e10", year: 0 });
    anchor(a!, "famine", { id: "e7", year: 0 });
    expect(
      causesFrom(1, [
        [a, "famine"],
        [a, warKey(b!.id)],
        [b, warKey(a!.id)],
        [undefined, "famine"],
      ]),
    ).toEqual(["e7", "e10"]);
  });

  it("rilasciato, un ancoraggio non è più citato", () => {
    const tribe = world("ancore-rilascio").tribes[0]!;
    anchor(tribe, "revolt", { id: "e3", year: 0 });
    releaseAnchor(tribe, "revolt");
    expect(anchored(tribe, "revolt", 0)).toBeNull();
  });
});

describe("collegamenti in simulazione", () => {
  const state = createWorld({ seed: "catene-simulate", width: 64, height: 64 });
  const result = runSimulation(state, 500);
  const byId = new Map(result.events.map((e) => [e.id, e]));

  it("ogni causa citata esiste ed è avvenuta prima o nello stesso anno", () => {
    let links = 0;
    for (const event of result.events) {
      for (const id of event.causeEventIds) {
        const cause = byId.get(id);
        expect(cause, `${event.id} cita ${id}`).toBeDefined();
        expect(cause!.tick).toBeLessThanOrEqual(event.tick);
        expect(id).not.toBe(event.id);
        links++;
      }
    }
    expect(links).toBeGreaterThan(0);
  });

  it("una pace cita la dichiarazione di guerra fra gli stessi due popoli", () => {
    const peaces = result.events.filter((e) => e.type === "peace" && e.causeEventIds.length > 0);
    expect(peaces.length).toBeGreaterThan(0);
    for (const peace of peaces) {
      const war = peace.causeEventIds.map((id) => byId.get(id)!).find((e) => e.subtype === "war_declared");
      expect(war).toBeDefined();
      const sides = (e: typeof peace) =>
        e.actors
          .filter((a) => a.kind === "tribe")
          .map((a) => a.id)
          .sort();
      expect(sides(war!)).toEqual(sides(peace));
    }
  });

  it("una battaglia cita la guerra in cui si combatte", () => {
    for (const battle of result.events.filter((e) => e.type === "battle" && e.causeEventIds.length > 0)) {
      expect(battle.causeEventIds.map((id) => byId.get(id)!.subtype)).toContain("war_declared");
    }
  });

  it("una riscoperta cita la perdita della stessa tecnica", () => {
    for (const found of result.events.filter(
      (e) => e.subtype === "rediscovery" && e.causeEventIds.length > 0,
    )) {
      const loss = byId.get(found.causeEventIds[0]!)!;
      expect(loss.subtype).toBe("lost");
      expect(loss.metadata.techId).toBe(found.metadata.techId);
    }
  });

  it("gli ancoraggi restano limitati su ogni popolo", () => {
    for (const tribe of state.tribes) {
      expect(Object.keys(tribe.causalAnchors).length).toBeLessThanOrEqual(MAX_ANCHORS);
    }
  });
});

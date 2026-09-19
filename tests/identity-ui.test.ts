import { HISTORICAL_IDENTITIES, parseRosterConfig } from "@genesis/simulation-core";
import { describe, expect, it } from "vitest";
import {
  competitivePreset,
  DEFAULT_ROSTER_FORM,
  filterIdentities,
  maxRosterSize,
  rosterProblem,
  toRosterInput,
} from "@/lib/client/identity";
import { toIdentitySummary } from "@/lib/services/identity-dto";

const catalog = HISTORICAL_IDENTITIES.map(toIdentitySummary);

describe("selettore del roster", () => {
  it("il form di default produce un roster valido per il motore", () => {
    const input = toRosterInput(DEFAULT_ROSTER_FORM);
    expect(parseRosterConfig(input).mode).toBe("random-real");
    expect(rosterProblem(DEFAULT_ROSTER_FORM, 48)).toBeNull();
  });

  it("segnala roster incompleti o troppo grandi per la mappa", () => {
    expect(rosterProblem({ ...DEFAULT_ROSTER_FORM, mode: "selected", identityKeys: ["roman"] })).toMatch(
      /almeno 2/,
    );
    expect(
      rosterProblem({
        ...DEFAULT_ROSTER_FORM,
        mode: "custom",
        identityKeys: ["a", "b", "c"],
        civilizationCount: 2,
      }),
    ).toMatch(/più identità/);
    expect(rosterProblem({ ...DEFAULT_ROSTER_FORM, mode: "all-real" }, 32)).toMatch(/al massimo/);
    expect(rosterProblem({ ...DEFAULT_ROSTER_FORM, mode: "all-real" }, 64)).toBeNull();
    expect(rosterProblem({ ...DEFAULT_ROSTER_FORM, mode: "procedural" }, 32)).toBeNull();
    expect(maxRosterSize(32, 32)).toBe(17);
  });

  it("le chiavi scelte vengono inviate solo nelle modalità che le usano", () => {
    const state = { ...DEFAULT_ROSTER_FORM, identityKeys: ["roman", "greek"] };
    expect(toRosterInput({ ...state, mode: "random-real" }).identityKeys).toEqual([]);
    expect(toRosterInput({ ...state, mode: "selected" }).identityKeys).toEqual(["roman", "greek"]);
  });

  it("il preset competitivo spegne i modificatori e bilancia le partenze", () => {
    const preset = competitivePreset({ ...DEFAULT_ROSTER_FORM, balancedPlacement: false });
    expect(preset).toMatchObject({
      enableIdentityModifiers: false,
      balancedPlacement: true,
      equalStartingLevel: true,
    });
  });

  it("ricerca e filtri del catalogo lato client", () => {
    expect(
      filterIdentities(catalog, { search: "vichinghi", category: "", continent: "" }).map((i) => i.key),
    ).toEqual(["norse"]);
    expect(
      filterIdentities(catalog, { search: "nilo", category: "", continent: "" }).map((i) => i.key),
    ).toEqual(expect.arrayContaining(["egyptian", "nubian"]));
    const americas = filterIdentities(catalog, { search: "", category: "", continent: "americas" });
    expect(americas.map((i) => i.key).sort()).toEqual(["inca", "maya", "mexica"]);
    expect(
      filterIdentities(catalog, { search: "", category: "classical", continent: "europe" }).length,
    ).toBeGreaterThan(0);
  });
});

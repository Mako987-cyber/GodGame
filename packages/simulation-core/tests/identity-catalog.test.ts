import { describe, expect, it } from "vitest";
import {
  HISTORICAL_IDENTITIES,
  IDENTITY_BY_KEY,
  MAX_IDENTITY_MODIFIER,
  MAX_IDENTITY_MODIFIER_SUM,
  TECH_BY_ID,
  historicalIdentitySchema,
  identityPersonName,
  identityPlaceName,
  politicalName,
  politicalTitle,
  successorName,
  type GovernmentType,
} from "../src/index";

const GOVERNMENTS: GovernmentType[] = [
  "clan",
  "elder_council",
  "chiefdom",
  "tribal_monarchy",
  "city_state",
  "merchant_republic",
];

describe("catalogo delle identità storiche", () => {
  it("contiene almeno 12 identità, tutte valide per lo schema", () => {
    expect(HISTORICAL_IDENTITIES.length).toBeGreaterThanOrEqual(12);
    for (const identity of HISTORICAL_IDENTITIES) {
      const parsed = historicalIdentitySchema.safeParse(identity);
      expect(parsed.success, `${identity.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("chiavi, nomi e colori primari sono univoci", () => {
    const keys = HISTORICAL_IDENTITIES.map((i) => i.key);
    const names = HISTORICAL_IDENTITIES.map((i) => i.displayName);
    const colors = HISTORICAL_IDENTITIES.map((i) => i.visualProfile.primaryColor);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(colors).size).toBe(colors.length);
    expect(IDENTITY_BY_KEY.size).toBe(keys.length);
  });

  it("gli alias sono non vuoti, senza duplicati e non coincidono con altre identità", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      const lower = identity.aliases.map((a) => a.toLowerCase());
      expect(new Set(lower).size, identity.key).toBe(lower.length);
      for (const other of HISTORICAL_IDENTITIES) {
        if (other.key === identity.key) continue;
        expect(lower).not.toContain(other.displayName.toLowerCase());
      }
    }
  });

  it("palette esadecimali valide e distinte", () => {
    for (const { visualProfile } of HISTORICAL_IDENTITIES) {
      expect(visualProfile.primaryColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(visualProfile.secondaryColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(visualProfile.primaryColor).not.toBe(visualProfile.secondaryColor);
    }
  });

  it("i modificatori sono leggeri, bilanciati e hanno sempre un compromesso", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      const mods = identity.behavioralModifiers;
      const sum = mods.reduce((acc, m) => acc + m.value, 0);
      expect(Math.abs(sum), identity.key).toBeLessThanOrEqual(MAX_IDENTITY_MODIFIER_SUM);
      for (const m of mods) {
        expect(Math.abs(m.value)).toBeLessThanOrEqual(MAX_IDENTITY_MODIFIER);
        expect(m.tradeoff.length).toBeGreaterThan(3);
      }
      if (mods.some((m) => m.value > 0))
        expect(
          mods.some((m) => m.value < 0),
          identity.key,
        ).toBe(true);
    }
  });

  it("nessuna identità porta con sé tecnologie, governi, territori o date", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      const keys = Object.keys(identity);
      for (const forbidden of [
        "startingTechnologies",
        "technologies",
        "territory",
        "startYear",
        "leaders",
        "cities",
      ])
        expect(keys, identity.key).not.toContain(forbidden);
      // Descriptions never name a technology id the engine could pick up.
      for (const techId of TECH_BY_ID.keys())
        expect(JSON.stringify(identity.culturalTags)).not.toContain(techId);
    }
  });

  it("il profilo dei nomi genera nomi deterministici e mai riservati (personaggi o città reali)", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      const reserved = new Set(identity.namingProfile.reservedNames.map((n) => n.toLowerCase()));
      for (let i = 0; i < 400; i++) {
        const sex = i % 2 === 0 ? "M" : "F";
        const name = identityPersonName(identity.namingProfile, `seed:p${i}`, sex);
        expect(name).toBe(identityPersonName(identity.namingProfile, `seed:p${i}`, sex));
        expect(name.length).toBeGreaterThanOrEqual(2);
        expect(name[0]).toBe(name[0]?.toUpperCase());
        expect(reserved.has(name.toLowerCase()), `${identity.key}: ${name}`).toBe(false);
      }
      const used = new Set<string>();
      for (let i = 0; i < 80; i++) {
        const place = identityPlaceName(identity.namingProfile, `seed:s${i}`, used);
        expect(used.has(place)).toBe(false);
        expect(reserved.has(place.toLowerCase()), `${identity.key}: ${place}`).toBe(false);
        used.add(place);
      }
    }
  });

  it("i nomi dei successori restano legati all'identità e non si ripetono", () => {
    const egyptian = IDENTITY_BY_KEY.get("egyptian")!;
    const used = new Set<string>(["Egizi"]);
    const north = successorName(egyptian, { x: 10, y: 10 }, { x: 10, y: 2 }, "Naru", used);
    expect(north).toBe("Egizi del Nord");
    used.add(north);
    expect(successorName(egyptian, { x: 10, y: 10 }, { x: 10, y: 1 }, "Naru", used)).toBe("Egizi di Naru");
    used.add("Egizi di Naru");
    expect(successorName(egyptian, { x: 10, y: 10 }, { x: 10, y: 1 }, "Naru", used)).toBe("Egizi di Naru 2");
  });

  it("titoli e nomi politici dipendono solo dal governo", () => {
    for (const gov of GOVERNMENTS) {
      expect(politicalTitle(gov, "M").length).toBeGreaterThan(1);
      expect(politicalTitle(gov, "F").length).toBeGreaterThan(1);
      expect(politicalName(gov, "Naru")).toMatch(/ di Naru$/);
    }
    expect(politicalTitle("tribal_monarchy", "F")).toBe("regina");
    expect(politicalTitle("clan", "M")).toBe("guida del clan");
    expect(politicalName("tribal_monarchy", "Naru")).toBe("Regno di Naru");
  });
});

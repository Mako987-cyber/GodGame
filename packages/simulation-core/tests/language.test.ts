import { describe, expect, it } from "vitest";
import {
  articled,
  createWorld,
  definiteArticle,
  formatCivilizationSubject,
  formatCivilizationName,
  formatEventDescription,
  formatLeaderTitle,
  formatPoliticalEntityName,
  formatSettlement,
  HISTORICAL_IDENTITIES,
  IDENTITY_BY_KEY,
  leaderPhrase,
  np,
  peoplePhrase,
  polityPhrase,
  renderTemplate,
  runSimulation,
  settlementPhrase,
  statePhrase,
  type HistoricalEvent,
} from "../src/index";

const people = (
  name: string,
  identityType: "historical" | "procedural" | "legacy" | "composite",
  identityId: string | null = null,
) => ({
  name,
  identityType,
  identityId,
});

describe("articoli e preposizioni", () => {
  it("articolo determinativo: il/lo/l'/i/gli/la/le", () => {
    expect(definiteArticle("Regno", "m", "sg")).toBe("il");
    expect(definiteArticle("Stato", "m", "sg")).toBe("lo");
    expect(definiteArticle("Impero", "m", "sg")).toBe("l'");
    expect(definiteArticle("Romani", "m", "pl")).toBe("i");
    expect(definiteArticle("Egizi", "m", "pl")).toBe("gli");
    expect(definiteArticle("Spagnoli", "m", "pl")).toBe("gli");
    expect(definiteArticle("Zapotechi", "m", "pl")).toBe("gli");
    expect(definiteArticle("Lega", "f", "sg")).toBe("la");
    expect(definiteArticle("Unione", "f", "sg")).toBe("l'");
    expect(definiteArticle("tribù", "f", "pl")).toBe("le");
  });

  it("preposizioni articolate e non", () => {
    expect(articled(np("Egizi", "m", "pl"), "di")).toBe("degli Egizi");
    expect(articled(np("Inca", "m", "pl"), "da")).toBe("dagli Inca");
    expect(articled(np("Romani", "m", "pl"), "a")).toBe("ai Romani");
    expect(articled(np("Assiri", "m", "pl"), "su")).toBe("sugli Assiri");
    expect(articled(np("Impero di Kar", "m", "sg"), "di")).toBe("dell'Impero di Kar");
    expect(articled(np("Regno di Naru", "m", "sg"), "in")).toBe("nel Regno di Naru");
    expect(articled(np("tribù Kanar", "f", "sg"), "di")).toBe("della tribù Kanar");
    expect(articled(np("Romani", "m", "pl"), "con")).toBe("con i Romani");
  });
});

describe("popoli, stati e leader", () => {
  it("identità storiche: plurale con articolo, mai «la tribù Egizi»", () => {
    const egizi = people("Egizi", "historical", "egyptian");
    expect(formatCivilizationSubject(egizi)).toBe("gli Egizi");
    expect(formatCivilizationSubject(egizi, { capitalized: true })).toBe("Gli Egizi");
    expect(formatCivilizationSubject(egizi, { preposition: "di" })).toBe("degli Egizi");
    expect(formatCivilizationSubject(people("Egizi del Nord", "historical", "egyptian"))).toBe(
      "gli Egizi del Nord",
    );
    expect(formatCivilizationSubject(people("Romani", "historical", "roman"), { preposition: "a" })).toBe(
      "ai Romani",
    );
    for (const identity of HISTORICAL_IDENTITIES) {
      const subject = formatCivilizationSubject(people(identity.displayName, "historical", identity.key));
      expect(subject).toBe(identity.language.collectiveName);
      expect(subject).not.toMatch(/tribù/);
    }
  });

  it("civiltà procedurali e legacy: il nome inventato resta il nome di una tribù (singolare)", () => {
    const kanar = people("Kanar", "procedural");
    expect(formatCivilizationSubject(kanar)).toBe("la tribù Kanar");
    expect(
      formatCivilizationSubject(people("Elith", "legacy"), { preposition: "da", capitalized: true }),
    ).toBe("Dalla tribù Elith");
    expect(renderTemplate("{Art:p} {v:p:è nata|sono nati}", { p: peoplePhrase(kanar) })).toBe(
      "La tribù Kanar è nata",
    );
  });

  it("identità composite: plurale, articolate come i popoli", () => {
    const composite = people("Romano-Celti", "composite", null);
    expect(formatCivilizationSubject(composite)).toBe("i Romano-Celti");
    expect(formatCivilizationSubject(composite, { preposition: "di" })).toBe("dei Romano-Celti");
  });

  it("forme politiche: il genere viene dalla forma dello stato", () => {
    expect(formatPoliticalEntityName({ name: "Regno di Naru" })).toBe("il Regno di Naru");
    expect(formatPoliticalEntityName({ name: "Lega Romana" }, { preposition: "a" })).toBe("alla Lega Romana");
    expect(formatPoliticalEntityName({ name: "Città-stato di Vela" })).toBe("la Città-stato di Vela");
    expect(formatPoliticalEntityName({ name: "Dominio di Kar" }, { preposition: "di" })).toBe(
      "del Dominio di Kar",
    );
    expect(formatPoliticalEntityName({ name: "Confederazione Egizio-Celtica" })).toBe(
      "la Confederazione Egizio-Celtica",
    );
    expect(formatPoliticalEntityName({ name: "Impero di Asur" }, { preposition: "da" })).toBe(
      "dall'Impero di Asur",
    );
  });

  it("chi agisce in diplomazia: lo stato se esiste, altrimenti il popolo", () => {
    const tribe = { ...people("Egizi", "historical", "egyptian"), civilizationId: "c1" };
    expect(polityPhrase(tribe, [{ id: "c1", name: "Regno di Naru", status: "active" }]).text).toBe(
      "Regno di Naru",
    );
    expect(polityPhrase(tribe, [{ id: "c1", name: "Regno di Naru", status: "collapsed" }]).text).toBe(
      "Egizi",
    );
  });

  it("titoli dei leader: dal governo, mai dall'identità", () => {
    const egyptian = IDENTITY_BY_KEY.get("egyptian");
    expect(formatLeaderTitle({ name: "Menka", sex: "M" }, "tribal_monarchy", egyptian)).toBe("re Menka");
    expect(formatLeaderTitle({ name: "Iria", sex: "F" }, "tribal_monarchy", egyptian)).toBe("regina Iria");
    expect(formatLeaderTitle({ name: "Menka", sex: "M" }, "merchant_republic")).toBe("console Menka");
    // Descriptive titles become an apposition.
    expect(formatLeaderTitle({ name: "Menka", sex: "M" }, "clan", egyptian)).toBe("Menka, guida del clan");
    expect(formatLeaderTitle({ name: "Menka", sex: "M" }, "chiefdom")).toBe("Menka, signore della valle");
  });

  it("nome nudo e sintagma del leader (API dei formattatori)", () => {
    const egizi = people("Egizi", "historical", "egyptian");
    expect(formatCivilizationName(egizi)).toBe("Egizi");
    expect(formatCivilizationName({ name: "Regno di Naru" })).toBe("Regno di Naru");
    const king = leaderPhrase({ name: "Menka", sex: "M" }, "tribal_monarchy");
    expect(typeof king === "object" && articled(king)).toBe("il re Menka");
    const queen = leaderPhrase({ name: "Iria", sex: "F" }, "tribal_monarchy");
    expect(typeof queen === "object" && articled(queen)).toBe("la regina Iria");
    // A descriptive title is an apposition: no article to put in front of it.
    expect(leaderPhrase({ name: "Menka", sex: "M" }, "clan")).toBe("Menka, guida del clan");
  });

  it("insediamenti per rango", () => {
    expect(formatSettlement({ name: "Naru", tier: "village" })).toBe("il villaggio di Naru");
    expect(formatSettlement({ name: "Naru", tier: "camp" })).toBe("l'accampamento di Naru");
    expect(formatSettlement({ name: "Naru", tier: "town" }, { capitalized: true })).toBe("La città di Naru");
  });
});

describe("template degli eventi", () => {
  const egizi = peoplePhrase(people("Egizi", "historical", "egyptian"));

  it("le frasi desiderate", () => {
    expect(
      formatEventDescription("{Art:p} {v:p:ha fondato|hanno fondato} {art:s}.", {
        p: egizi,
        s: settlementPhrase({ name: "Naru", tier: "village" }),
      }),
    ).toBe("Gli Egizi hanno fondato il villaggio di Naru.");
    expect(
      formatEventDescription("{Art:a} {v:a:ha|hanno} dichiarato guerra {a:b}.", {
        a: statePhrase({ name: "Regno del Nilo" }),
        b: statePhrase({ name: "Lega Romana" }),
      }),
    ).toBe("Il Regno del Nilo ha dichiarato guerra alla Lega Romana.");
    expect(
      formatEventDescription("{Art:s} è passata sotto occupazione.", {
        s: settlementPhrase({ name: "Naru", tier: "town" }),
      }),
    ).toBe("La città di Naru è passata sotto occupazione.");
    expect(
      formatEventDescription("{Art:c} {v:c:ha|hanno} adottato la ceramica.", {
        c: statePhrase({ name: "Confederazione Egizio-Celtica" }),
      }),
    ).toBe("La Confederazione Egizio-Celtica ha adottato la ceramica.");
    expect(
      formatEventDescription("{Art:l} ha imposto un nuovo tributo.", { l: np("sovrano Menka", "m", "sg") }),
    ).toBe("Il sovrano Menka ha imposto un nuovo tributo.");
  });

  it("singolare e plurale concordano col soggetto", () => {
    const tpl = "{Art:p} {v:p:migra|migrano}";
    expect(formatEventDescription(tpl, { p: egizi })).toBe("Gli Egizi migrano");
    expect(formatEventDescription(tpl, { p: peoplePhrase(people("Kanar", "procedural")) })).toBe(
      "La tribù Kanar migra",
    );
  });

  it("un parametro mancante è un errore, mai un «{nome}» lasciato nel testo", () => {
    expect(() => renderTemplate("{Art:p} parte", {})).toThrow(/mancante/);
    expect(() => renderTemplate("{v:p:a|b}", { p: "stringa" })).toThrow(/sintagma/);
  });
});

describe("eventi generati dal motore", () => {
  it("nessuna frase meccanica nei testi di mondi storici e procedurali", () => {
    const events: HistoricalEvent[] = [];
    const names = new Set<string>();
    for (const seed of ["lingua-1", "lingua-2", "lingua-3"]) {
      const state = createWorld({
        seed,
        width: 48,
        height: 48,
        roster: { mode: "random-real", civilizationCount: 8 },
      });
      for (let i = 0; i < 8; i++) events.push(...runSimulation(state, 25).events);
      for (const t of state.tribes) if (t.identityId) names.add(t.name.split(" ")[0]!);
    }
    const procedural = createWorld({ seed: "lingua-proc", width: 48, height: 48 });
    for (let i = 0; i < 6; i++) events.push(...runSimulation(procedural, 25).events);
    expect(events.length).toBeGreaterThan(200);
    const texts = events.flatMap((e) => [e.title, e.description]);
    for (const text of texts) {
      expect(text, text).not.toMatch(/[{}]/);
      // "la tribù Egizi", "della tribù Romani"…
      for (const name of names) expect(text, text).not.toMatch(new RegExp(`tribù ${name}\\b`));
      // Plural articles before a vowel: "i Egizi", "dei Inca", "ai Assiri"…
      expect(text, text).not.toMatch(/\b(i|dei|ai|dai|nei|sui|coi) [AEIOUÀÈÉÌÒÙ][a-zà-ù]/);
      expect(text, text).not.toMatch(/\bCrolla (Regno|Lega|Dominio|Confederazione|Repubblica)\b/);
    }
  });
});

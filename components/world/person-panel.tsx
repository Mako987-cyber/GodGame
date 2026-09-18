"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorldDetail } from "@/lib/dto";
import { api, queryKeys } from "@/lib/client/api";
import { EVENT_LABELS, ROLE_LABELS, TITLE_LABELS, fmtDec, fmtPct, fmtYear } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLink, Facts, Meter, SubHeading } from "./stat-bits";

const SKILL_LABELS: Record<string, string> = {
  gathering: "Raccolta",
  hunting: "Caccia",
  building: "Costruzione",
  combat: "Combattimento",
  crafting: "Artigianato",
  leadership: "Comando",
};

const PERSONALITY_LABELS: Record<string, string> = {
  aggression: "Aggressività",
  cooperation: "Cooperazione",
  curiosity: "Curiosità",
  riskTolerance: "Propensione al rischio",
  sociability: "Socievolezza",
};

const DEATH_LABELS: Record<string, string> = {
  natural: "per vecchiaia",
  starvation: "di fame",
  conflict: "in battaglia",
  illness: "di malattia",
  epidemic: "durante un'epidemia",
  disaster: "in una calamità",
};

/** Detail of one person, fetched on demand: the world payload never carries the population. */
export function PersonPanel({ personId, detail }: { personId: string; detail: WorldDetail }) {
  const worldId = detail.world.id;
  const { select, focusOn } = useWorldUi();
  const query = useQuery({
    queryKey: queryKeys.person(worldId, personId),
    queryFn: () => api.person(worldId, personId),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="text-war text-sm">
        Dettaglio non disponibile: {query.error.message}{" "}
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }

  const p = query.data;
  const tribe = detail.tribes.find((t) => t.id === p.tribeId);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">{p.name}</h2>
          <p className="text-muted text-sm">
            {p.alive
              ? `${p.age} anni, nato nel ${fmtYear(p.birthYear)}`
              : `${fmtYear(p.birthYear)} – ${fmtYear(p.deathYear ?? 0)}, morto ${
                  DEATH_LABELS[p.deathCause ?? ""] ?? ""
                }`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {p.title && <Badge tone="ochre">{TITLE_LABELS[p.title] ?? p.title}</Badge>}
          <Badge tone={p.alive ? "growth" : "neutral"}>{p.alive ? "In vita" : "Deceduto"}</Badge>
        </div>
      </div>

      <Facts
        items={[
          ["Ruolo", ROLE_LABELS[p.role] ?? p.role],
          ["Sesso", p.sex === "M" ? "Maschio" : "Femmina"],
          [
            "Tribù",
            tribe ? (
              <EntityLink color={tribe.color} onClick={() => select({ kind: "tribe", id: tribe.id })}>
                {tribe.name}
              </EntityLink>
            ) : (
              (p.tribeName ?? "—")
            ),
          ],
          [
            "Insediamento",
            p.settlementId ? (
              <EntityLink onClick={() => select({ kind: "settlement", id: p.settlementId as string })}>
                {p.settlementName ?? p.settlementId}
              </EntityLink>
            ) : (
              "Nomade"
            ),
          ],
          ["Dinastia", p.dynasty ? p.dynasty.name : "Nessuna"],
          ["Ricchezza", fmtDec(p.wealth)],
        ]}
      />

      <SubHeading>Condizione</SubHeading>
      <div className="grid gap-1.5">
        <Meter label="Salute" value={p.health} tone={p.health < 0.4 ? "war" : "growth"} />
        <Meter label="Fame" value={p.hunger} tone="war" />
        <Meter label="Prestigio" value={p.prestige} tone="ochre" />
        <Meter label="Istruzione" value={p.education} tone="water" />
      </div>

      <SubHeading>Abilità</SubHeading>
      <div className="grid gap-1.5">
        {Object.entries(p.skills).map(([key, value]) => (
          <Meter key={key} label={SKILL_LABELS[key] ?? key} value={value} />
        ))}
      </div>

      <SubHeading>Indole</SubHeading>
      <div className="grid gap-1.5">
        {Object.entries(p.personality).map(([key, value]) => (
          <Meter key={key} label={PERSONALITY_LABELS[key] ?? key} value={value} tone="water" />
        ))}
      </div>

      <SubHeading>Famiglia</SubHeading>
      <ul className="grid gap-1 text-sm">
        {p.family.mother && (
          <li className="flex justify-between gap-2">
            <span className="text-muted">Madre</span>
            <EntityLink onClick={() => select({ kind: "person", id: p.family.mother!.id })}>
              {p.family.mother.name}
            </EntityLink>
          </li>
        )}
        {p.family.father && (
          <li className="flex justify-between gap-2">
            <span className="text-muted">Padre</span>
            <EntityLink onClick={() => select({ kind: "person", id: p.family.father!.id })}>
              {p.family.father.name}
            </EntityLink>
          </li>
        )}
        {p.family.partner && (
          <li className="flex justify-between gap-2">
            <span className="text-muted">Compagno/a</span>
            <EntityLink onClick={() => select({ kind: "person", id: p.family.partner!.id })}>
              {p.family.partner.name}
            </EntityLink>
          </li>
        )}
        {p.family.children.length > 0 ? (
          <li className="grid gap-1">
            <span className="text-muted">Figli ({p.family.children.length})</span>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {p.family.children.map((c) => (
                <EntityLink key={c.id} onClick={() => select({ kind: "person", id: c.id })}>
                  <span className={c.alive ? "" : "opacity-60"}>{c.name}</span>
                </EntityLink>
              ))}
            </span>
          </li>
        ) : (
          !p.family.mother &&
          !p.family.father &&
          !p.family.partner && <li className="text-muted">Nessun legame familiare registrato.</li>
        )}
      </ul>

      <SubHeading>Conoscenze</SubHeading>
      {p.knowledge.length === 0 ? (
        <p className="text-muted text-sm">Nessuna tecnica conosciuta.</p>
      ) : (
        <p className="text-sm">
          {p.knowledge.map((id) => detail.technologies.find((t) => t.id === id)?.name ?? id).join(", ")}
        </p>
      )}

      {p.events.length > 0 && (
        <>
          <SubHeading>Eventi</SubHeading>
          <ul className="grid gap-1.5 text-sm">
            {p.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[3.5rem_1fr] gap-2">
                <span className="text-muted text-right font-serif">{fmtYear(e.year)}</span>
                <span>
                  <span className="text-muted text-xs">{EVENT_LABELS[e.type] ?? e.type}</span>
                  <br />
                  {e.title}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {p.titleSinceYear !== null && p.title && (
        <p className="text-muted mt-3 text-xs">
          {TITLE_LABELS[p.title] ?? p.title} dal {fmtYear(p.titleSinceYear)}
          {p.alive ? "" : ` fino al ${fmtYear(p.deathYear ?? 0)}`}. Prestigio {fmtPct(p.prestige)}.
        </p>
      )}

      {tribe && (
        <Button size="sm" variant="ghost" className="mt-4" onClick={() => focusOn(tribe.x, tribe.y)}>
          <MapPin /> Centra sulla mappa
        </Button>
      )}
    </div>
  );
}

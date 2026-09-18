"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt, STATUS_LABELS, TIER_LABELS, TITLE_LABELS } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { CellPanel } from "./cell-panel";
import { CivilizationPanel, TribePanel } from "./civilization-panel";
import { PersonPanel } from "./person-panel";
import { SettlementPanel } from "./settlement-panel";

type ListTab = "tribes" | "settlements" | "civilizations" | "people";

export function WorldSidebar({ detail }: { detail: WorldDetail }) {
  const { selection, select } = useWorldUi();
  const [tab, setTab] = useState<ListTab>("tribes");

  let content: React.ReactNode = null;
  if (selection?.kind === "cell") content = <CellPanel x={selection.x} y={selection.y} detail={detail} />;
  if (selection?.kind === "tribe") {
    const tribe = detail.tribes.find((t) => t.id === selection.id);
    if (tribe) content = <TribePanel tribe={tribe} detail={detail} />;
  }
  if (selection?.kind === "settlement") {
    const s = detail.settlements.find((x) => x.id === selection.id);
    if (s) content = <SettlementPanel settlement={s} detail={detail} />;
  }
  if (selection?.kind === "civilization") {
    const c = detail.civilizations.find((x) => x.id === selection.id);
    if (c) content = <CivilizationPanel civ={c} detail={detail} />;
  }
  if (selection?.kind === "person") content = <PersonPanel personId={selection.id} detail={detail} />;

  if (content) {
    return (
      <div className="relative p-4">
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-2 right-2"
          aria-label="Chiudi dettaglio e torna agli elenchi"
          onClick={() => select(null)}
        >
          <X />
        </Button>
        {content}
      </div>
    );
  }

  const tribes = [...detail.tribes].sort(
    (a, b) => Number(a.status === "extinct") - Number(b.status === "extinct") || b.population - a.population,
  );
  const settlements = [...detail.settlements].sort(
    (a, b) => Number(a.status !== "active") - Number(b.status !== "active") || b.population - a.population,
  );
  return (
    <div className="grid gap-3 p-4">
      <p className="text-muted text-sm">
        Seleziona una cella, un villaggio o una tribù sulla mappa, oppure scegli dagli elenchi.
      </p>
      {detail.crises.length > 0 && (
        <p className="text-war text-sm">
          Crisi in corso: {detail.crises.length}. Usa il livello «Conflitti» della mappa per vederle.
        </p>
      )}
      <Tabs
        label="Elenchi"
        value={tab}
        onChange={setTab}
        items={[
          { value: "tribes", label: `Tribù (${detail.tribes.filter((t) => t.status !== "extinct").length})` },
          {
            value: "settlements",
            label: `Insediamenti (${detail.settlements.filter((s) => s.status === "active").length})`,
          },
          {
            value: "civilizations",
            label: `Civiltà (${detail.civilizations.filter((c) => c.status === "active").length})`,
          },
          { value: "people", label: `Figure (${detail.notablePeople.length})` },
        ]}
      />
      <ul className="grid gap-0.5">
        {tab === "tribes" &&
          tribes.map((t) => (
            <Row
              key={t.id}
              color={t.color}
              dim={t.status === "extinct"}
              onClick={() => select({ kind: "tribe", id: t.id })}
              name={t.name}
              meta={`${STATUS_LABELS[t.status]}, ${fmtInt(t.population)} persone`}
            />
          ))}
        {tab === "settlements" &&
          (settlements.length === 0 ? (
            <li className="text-muted text-sm">Nessun insediamento: le tribù sono ancora nomadi.</li>
          ) : (
            settlements.map((s) => (
              <Row
                key={s.id}
                color={detail.tribes.find((t) => t.id === s.tribeId)?.color}
                dim={s.status !== "active"}
                onClick={() => select({ kind: "settlement", id: s.id })}
                name={s.name}
                meta={
                  s.status === "active"
                    ? `${TIER_LABELS[s.tier] ?? `livello ${s.level}`}, ${fmtInt(s.population)} abitanti`
                    : "abbandonato"
                }
              />
            ))
          ))}
        {tab === "people" &&
          (detail.notablePeople.length === 0 ? (
            <li className="text-muted text-sm">
              Nessuna figura di rilievo: guide, fondatori e inventori compaiono qui.
            </li>
          ) : (
            detail.notablePeople.map((p) => (
              <Row
                key={p.id}
                color={detail.tribes.find((t) => t.id === p.tribeId)?.color}
                onClick={() => select({ kind: "person", id: p.id })}
                name={p.name}
                meta={`${p.title ? `${TITLE_LABELS[p.title] ?? p.title}, ` : ""}${p.age} anni`}
              />
            ))
          ))}
        {tab === "civilizations" &&
          (detail.civilizations.length === 0 ? (
            <li className="text-muted text-sm">
              Nessuna civiltà. Nasce quando una tribù supera i 100 abitanti con almeno due insediamenti.
            </li>
          ) : (
            detail.civilizations.map((c) => (
              <Row
                key={c.id}
                color={c.color}
                dim={c.status !== "active"}
                onClick={() => select({ kind: "civilization", id: c.id })}
                name={c.name}
                meta={`${fmtInt(c.population)} persone`}
              />
            ))
          ))}
      </ul>
    </div>
  );
}

function Row({
  name,
  meta,
  color,
  dim,
  onClick,
}: {
  name: string;
  meta: string;
  color?: string;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`hover:bg-raised flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm ${dim ? "opacity-55" : ""}`}
      >
        <span className="flex items-center gap-2">
          {color && <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden />}
          {name}
        </span>
        <span className="text-muted text-xs">{meta}</span>
      </button>
    </li>
  );
}

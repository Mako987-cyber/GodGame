"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt, STATUS_LABELS, TIER_LABELS, TITLE_LABELS } from "@/lib/client/format";
import { useWorldUi, type Selection } from "@/lib/client/store";
import { CellPanel } from "./cell-panel";
import { CivilizationPanel, TribePanel } from "./civilization-panel";
import { PersonPanel } from "./person-panel";
import { SettlementPanel } from "./settlement-panel";
import { WarPanel } from "./war-panel";

type ListTab = "tribes" | "settlements" | "civilizations" | "people";

/** Detail of the selected entity, or null when nothing (known) is selected. */
export function selectionContent(detail: WorldDetail, selection: Selection | null): React.ReactNode {
  if (!selection) return null;
  switch (selection.kind) {
    case "cell":
      return <CellPanel x={selection.x} y={selection.y} detail={detail} />;
    case "tribe": {
      const tribe = detail.tribes.find((t) => t.id === selection.id);
      return tribe ? <TribePanel tribe={tribe} detail={detail} /> : null;
    }
    case "settlement": {
      const s = detail.settlements.find((x) => x.id === selection.id);
      return s ? <SettlementPanel settlement={s} detail={detail} /> : null;
    }
    case "civilization": {
      const c = detail.civilizations.find((x) => x.id === selection.id);
      return c ? <CivilizationPanel civ={c} detail={detail} /> : null;
    }
    case "person":
      return <PersonPanel personId={selection.id} detail={detail} />;
    case "war":
      return <WarPanel aId={selection.aId} bId={selection.bId} detail={detail} />;
  }
}

/** Lists of tribes, settlements, civilizations and notable people (the overview panel). */
export function EntityLists({ detail, onPick }: { detail: WorldDetail; onPick?: () => void }) {
  const selectRaw = useWorldUi((s) => s.select);
  const select = (sel: Selection) => {
    selectRaw(sel);
    onPick?.();
  };
  const [tab, setTab] = useState<ListTab>("civilizations");

  const tribes = [...detail.tribes].sort(
    (a, b) => Number(a.status === "extinct") - Number(b.status === "extinct") || b.population - a.population,
  );
  const settlements = [...detail.settlements].sort(
    (a, b) => Number(a.status !== "active") - Number(b.status !== "active") || b.population - a.population,
  );
  return (
    <div className="grid gap-3">
      {detail.crises.length > 0 && (
        <p className="text-war text-sm">
          Crisi in corso: {detail.crises.length}. Attiva la lente «Conflitti» per vederle sulla mappa.
        </p>
      )}
      <Tabs
        label="Elenchi"
        value={tab}
        onChange={setTab}
        items={[
          {
            value: "civilizations",
            label: `Civiltà (${detail.civilizations.filter((c) => c.status === "active").length})`,
          },
          {
            value: "settlements",
            label: `Insediamenti (${detail.settlements.filter((s) => s.status === "active").length})`,
          },
          { value: "tribes", label: `Tribù (${detail.tribes.filter((t) => t.status !== "extinct").length})` },
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

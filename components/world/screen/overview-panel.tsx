"use client";

import { Landmark } from "lucide-react";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLists } from "../entity-lists";
import { FloatingPanel } from "./floating-panel";

/** Civilizations, settlements, tribes and notable people: opened on demand, never always on. */
export function OverviewPanel({ detail }: { detail: WorldDetail }) {
  const closePanel = useWorldUi((s) => s.closePanel);
  const s = detail.world.summary;
  return (
    <FloatingPanel
      title="Civiltà e insediamenti"
      subtitle={`${fmtInt(s.civilizations)} civiltà · ${fmtInt(s.settlements)} insediamenti · ${fmtInt(s.tribes)} tribù`}
      icon={<Landmark />}
      onClose={closePanel}
      className="sm:top-[7.25rem] sm:left-[4.25rem] sm:max-h-[calc(100dvh-13rem)] sm:w-80 lg:top-[4.25rem] lg:max-h-[calc(100dvh-10rem)]"
    >
      <EntityLists detail={detail} />
    </FloatingPanel>
  );
}

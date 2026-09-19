"use client";

import {
  ArrowLeft,
  Bug,
  Camera,
  Info,
  Layers,
  Menu as MenuIcon,
  ScrollText,
  Trash2,
  BarChart3,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui/menu";

/** Main menu of the world screen (a keyboard-navigable popover). */
export function WorldMenu({
  onMapSettings,
  onDebug,
  debugActive,
  onInfo,
  onSnapshot,
  onChronicle,
  onStats,
  onDelete,
}: {
  onMapSettings: () => void;
  onDebug: () => void;
  debugActive: boolean;
  onInfo: () => void;
  onSnapshot: () => void;
  onChronicle: () => void;
  onStats: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  return (
    <Menu
      label="Menu del mondo"
      items={[
        {
          id: "back",
          label: "Torna all'elenco dei mondi",
          icon: <ArrowLeft />,
          onSelect: () => router.push("/worlds"),
        },
        { id: "info", label: "Informazioni sul mondo", icon: <Info />, onSelect: onInfo },
        { id: "chronicle", label: "Cronaca completa", icon: <ScrollText />, onSelect: onChronicle },
        { id: "stats", label: "Statistiche", icon: <BarChart3 />, onSelect: onStats },
        { id: "map", label: "Impostazioni mappa", icon: <Layers />, onSelect: onMapSettings },
        {
          id: "debug",
          label: debugActive ? "Esci dalla modalità debug" : "Modalità debug (mappa tecnica)",
          icon: <Bug />,
          onSelect: onDebug,
        },
        { id: "snapshot", label: "Snapshot", icon: <Camera />, onSelect: onSnapshot },
        { id: "delete", label: "Elimina mondo…", icon: <Trash2 />, tone: "danger", onSelect: onDelete },
      ]}
      trigger={(t) => (
        <button
          {...t}
          type="button"
          aria-label="Menu del mondo"
          title="Menu"
          className="text-parchment/85 hover:bg-raised grid size-9 place-items-center rounded-lg"
        >
          <MenuIcon className="size-4" />
        </button>
      )}
    />
  );
}

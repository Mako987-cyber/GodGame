"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorldListItem } from "@/lib/dto";
import { DeleteWorldDialog } from "./delete-world-dialog";

/** Delete button of a world card (outside the card link, so it is never a nested control). */
export function WorldCardActions({ world }: { world: WorldListItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Elimina il mondo ${world.name}`}
        title="Elimina mondo"
        className="text-muted hover:text-war hover:bg-war/10 absolute right-3 bottom-3 grid size-8 place-items-center rounded-md transition-colors"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
      <DeleteWorldDialog
        world={world}
        open={open}
        onClose={() => setOpen(false)}
        onDeleted={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { WorldListItem } from "@/lib/dto";
import { deletionErrorMessage, resumeDeletionFlow } from "@/lib/client/world-deletion";
import { DeleteWorldDialog } from "./delete-world-dialog";

/** Delete button of a world card (outside the card link, so it is never a nested control). */
export function WorldCardActions({ world }: { world: WorldListItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (world.status === "deleting") return <PendingDeletion world={world} onDone={() => router.refresh()} />;
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

/**
 * A deletion confirmed earlier and not finished (tab closed, very large world): the world is
 * already hidden everywhere, so the purge simply resumes, no second confirmation needed.
 */
function PendingDeletion({ world, onDone }: { world: WorldListItem; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(world.deletion?.progress ?? 0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const resume = async () => {
    setError(null);
    try {
      await resumeDeletionFlow(queryClient, world.id, undefined, {
        onProgress: (s) => setProgress(s.progress ?? 0),
      });
      onDone();
    } catch (e) {
      setError(deletionErrorMessage(e));
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void resume();
    // Runs once per mounted card: the flow itself polls until completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="bg-surface/90 absolute inset-0 grid place-items-center rounded-lg p-4 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="grid gap-2">
        <p className="text-sm">
          {error ? (
            <span className="text-war">{error}</span>
          ) : (
            <>
              <Loader2 className="mr-1.5 inline size-4 animate-spin" aria-hidden />
              Eliminazione di «{world.name}» in corso… {Math.round(progress * 100)}%
            </>
          )}
        </p>
        {error && (
          <button
            type="button"
            onClick={() => void resume()}
            className="text-ochre text-sm underline-offset-4 hover:underline"
          >
            Riprova
          </button>
        )}
      </div>
    </div>
  );
}

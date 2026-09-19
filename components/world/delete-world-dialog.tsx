"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DELETED_CONTENT,
  WORLDS_PATH,
  confirmationMatches,
  deleteWorldFlow,
  deletionErrorMessage,
} from "@/lib/client/world-deletion";
import { deleteConfirmationPhrase } from "@/lib/validation/world";

export interface DeletableWorld {
  id: string;
  name: string;
  seed: string;
  status: "running" | "paused";
}

/**
 * Irreversible deletion of a world. The user types `ELIMINA <nome>`; the button stays disabled
 * until the text matches, cannot be pressed twice, and the server checks the phrase again.
 */
export function DeleteWorldDialog({
  world,
  open,
  onClose,
  onDeleted,
}: {
  world: DeletableWorld;
  open: boolean;
  onClose: () => void;
  /** Called after a successful deletion; defaults to going back to the world list. */
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inputId = useId();
  const phrase = deleteConfirmationPhrase(world.name);
  const matches = confirmationMatches(world.name, typed);

  const close = () => {
    if (busy) return;
    setTyped("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!matches || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await deleteWorldFlow(queryClient, world, typed);
      setTyped("");
      if (onDeleted) onDeleted();
      else {
        router.replace(WORLDS_PATH);
        router.refresh();
      }
    } catch (e) {
      setError(deletionErrorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!busy}
      tone="danger"
      title="Eliminare questo mondo?"
      description="L'operazione è definitiva e non può essere annullata."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="danger"
            className="bg-war/15"
            disabled={!matches || busy}
            aria-disabled={!matches || busy}
            onClick={submit}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            {busy ? "Eliminazione in corso…" : "Elimina definitivamente"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="border-war/40 bg-war/10 flex gap-3 rounded-lg border p-3">
          <AlertTriangle className="text-war mt-0.5 size-5 shrink-0" aria-hidden />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-muted">Mondo</dt>
            <dd className="font-medium break-all">{world.name}</dd>
            <dt className="text-muted">Seed</dt>
            <dd className="break-all">{world.seed}</dd>
          </dl>
        </div>
        <div>
          <p className="mb-1.5 text-sm">Verranno eliminati per sempre:</p>
          <ul className="text-muted grid list-disc gap-0.5 pl-5 text-sm">
            {DELETED_CONTENT.map((item) => (
              <li key={item}>{item}</li>
            ))}
            <li>tutti gli altri dati associati a questo mondo</li>
          </ul>
          <p className="text-muted mt-2 text-xs">
            Gli altri mondi e il catalogo delle tecnologie non vengono toccati.
            {world.status === "running" &&
              " Il mondo è in esecuzione: verrà messo in pausa prima dell'eliminazione."}
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={inputId} className="text-sm">
            Per confermare scrivi esattamente{" "}
            <code className="bg-abyss text-parchment rounded px-1.5 py-0.5 font-mono text-[13px] select-all">
              {phrase}
            </code>
          </label>
          <Input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={typed.length > 0 && !matches}
            aria-describedby={`${inputId}-hint`}
            className="font-mono"
          />
          <p id={`${inputId}-hint`} className="text-muted text-xs" aria-live="polite">
            {typed.length === 0
              ? "Maiuscole, spazi e accenti devono coincidere."
              : matches
                ? "Testo corretto: puoi procedere."
                : "Il testo non coincide ancora."}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-war text-sm">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dices } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { api, queryKeys } from "@/lib/client/api";
import {
  DEFAULT_ROSTER_FORM,
  rosterProblem,
  toRosterInput,
  type RosterFormState,
} from "@/lib/client/identity";
import { RosterPicker } from "./roster-picker";
import { TerrainPreview } from "./terrain-preview";

const SIZES = [32, 48, 64] as const;

function randomSeed() {
  const words = ["aurora", "brace", "cenere", "duna", "eco", "fiume", "gelo", "rupe", "selva", "vento"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 100000)}`;
}

export function CreateWorldForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(() => "genesis");
  const [size, setSize] = useState<(typeof SIZES)[number]>(48);
  const [roster, setRoster] = useState<RosterFormState>(DEFAULT_ROSTER_FORM);
  const previewSeed = useDeferredValue(seed.trim());
  const problem = rosterProblem(roster, size);

  const mutation = useMutation({
    mutationFn: () =>
      api.createWorld({
        name: name.trim() || `Mondo ${seed}`,
        seed: seed.trim() || undefined,
        width: size,
        height: size,
        roster: toRosterInput(roster),
      }),
    onSuccess: ({ worldId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
      router.push(`/worlds/${worldId}`);
    },
  });

  return (
    <form
      id="nuovo-mondo"
      className="border-line bg-surface grid gap-5 rounded-lg border p-5 sm:grid-cols-[1fr_minmax(0,220px)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) mutation.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl">Crea un nuovo mondo</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="world-name">Nome</Label>
          <Input
            id="world-name"
            value={name}
            maxLength={60}
            placeholder="Terre del Nord"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="world-seed">Seed</Label>
          <div className="flex gap-2">
            <Input
              id="world-seed"
              value={seed}
              maxLength={64}
              placeholder="Lascia vuoto per un seed casuale"
              onChange={(e) => setSeed(e.target.value)}
            />
            <Button size="icon" aria-label="Genera un seed casuale" onClick={() => setSeed(randomSeed())}>
              <Dices />
            </Button>
          </div>
          <p className="text-muted text-xs">
            Lo stesso seed genera sempre la stessa mappa, le stesse civiltà e gli stessi leader iniziali.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="world-size">Dimensione mappa</Label>
          <Select
            id="world-size"
            value={size}
            onChange={(e) => setSize(Number(e.target.value) as (typeof SIZES)[number])}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s} × {s} celle
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <TerrainPreview seed={previewSeed} size={size} />
        <p className="text-muted text-xs">
          {previewSeed
            ? "Anteprima del terreno generato da questo seed"
            : "Il seed casuale sarà scelto alla creazione"}
        </p>
      </div>
      <div className="grid gap-4 sm:col-span-2">
        <RosterPicker value={roster} onChange={setRoster} />
        {(problem ?? mutation.error) && (
          <p role="alert" className="text-war text-sm">
            {problem ?? mutation.error?.message}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={mutation.isPending || problem !== null}
          className="self-start"
        >
          {mutation.isPending ? "Creazione in corso…" : "Crea il mondo"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Info, Scale, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { api, queryKeys } from "@/lib/client/api";
import {
  ALTERNATE_HISTORY_NOTICE,
  CATEGORY_LABELS,
  competitivePreset,
  CONTINENT_LABELS,
  filterIdentities,
  ROSTER_LIMITS,
  ROSTER_MODE_LABELS,
  type RosterFormState,
  type RosterModeKey,
} from "@/lib/client/identity";
import type { IdentitySummaryDTO } from "@/lib/dto";
import { cn } from "@/lib/utils/cn";
import { IdentityEmblem } from "./identity-emblem";

const MODES = Object.keys(ROSTER_MODE_LABELS) as RosterModeKey[];

function Toggle({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", disabled && "text-muted")}>
      <input
        type="checkbox"
        className="accent-ochre mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

function IdentityPreview({ identity }: { identity: IdentitySummaryDTO }) {
  return (
    <div className="border-line bg-abyss grid gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <IdentityEmblem emblemKey={identity.emblemKey} color={identity.primaryColor} size="lg" />
        <div>
          <p className="font-serif text-lg leading-tight">{identity.displayName}</p>
          <p className="text-muted text-xs">
            {identity.periodLabel} · {identity.geographicAssociations.join(", ")}
          </p>
        </div>
        <span className="ml-auto flex gap-1" aria-label="Palette">
          <span className="size-4 rounded-sm" style={{ background: identity.primaryColor }} />
          <span className="size-4 rounded-sm" style={{ background: identity.secondaryColor }} />
        </span>
      </div>
      <p className="text-sm">{identity.description}</p>
      <p className="text-muted text-xs">
        Nota storica statica. Nel mondo generato questo popolo parte come tutti gli altri: utensili di pietra,
        governo di clan, nessun territorio o leader storico.
      </p>
    </div>
  );
}

export function RosterPicker({
  value,
  onChange,
}: {
  value: RosterFormState;
  onChange: (next: RosterFormState) => void;
}) {
  const picking = value.mode === "selected" || value.mode === "custom";
  // The catalog is fetched only when the player actually picks identities.
  const catalog = useQuery({
    queryKey: queryKeys.identities,
    queryFn: api.identities,
    enabled: picking,
    staleTime: Infinity,
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [continent, setContinent] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const items = useMemo(
    () => filterIdentities(catalog.data?.items ?? [], { search, category, continent }),
    [catalog.data, search, category, continent],
  );
  const preview =
    catalog.data?.items.find((i) => i.key === focused) ??
    catalog.data?.items.find((i) => i.key === value.identityKeys.at(-1));

  const set = (patch: Partial<RosterFormState>) => onChange({ ...value, ...patch });
  const toggleKey = (key: string) =>
    set({
      identityKeys: value.identityKeys.includes(key)
        ? value.identityKeys.filter((k) => k !== key)
        : [...value.identityKeys, key],
    });

  return (
    <fieldset className="border-line grid gap-4 border-t pt-4">
      <legend className="sr-only">Civiltà</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-xl">Civiltà</h3>
        <p className="text-ochre flex items-center gap-1.5 text-sm">
          <Info className="size-4" aria-hidden /> {ALTERNATE_HISTORY_NOTICE}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label id="roster-mode-label">Modalità del roster</Label>
        <div role="radiogroup" aria-labelledby="roster-mode-label" className="flex flex-wrap gap-1.5">
          {MODES.map((mode) => (
            <Button
              key={mode}
              size="sm"
              role="radio"
              aria-checked={value.mode === mode}
              variant={value.mode === mode ? "primary" : "secondary"}
              onClick={() => set({ mode })}
            >
              {ROSTER_MODE_LABELS[mode]?.label}
            </Button>
          ))}
        </div>
        <p className="text-muted text-xs">{ROSTER_MODE_LABELS[value.mode]?.hint}</p>
      </div>

      {(value.mode === "random-real" || value.mode === "custom") && (
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="roster-count">Numero di civiltà</Label>
          <Select
            id="roster-count"
            value={value.civilizationCount}
            onChange={(e) => set({ civilizationCount: Number(e.target.value) })}
          >
            {Array.from(
              { length: ROSTER_LIMITS.max - ROSTER_LIMITS.min + 1 },
              (_, i) => ROSTER_LIMITS.min + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n} civiltà
              </option>
            ))}
          </Select>
          <p className="text-muted text-xs">
            Più civiltà richiedono mappe più grandi (circa 60 celle ciascuna).
          </p>
        </div>
      )}

      {picking && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <div className="grid content-start gap-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <Search className="text-muted pointer-events-none absolute top-3 left-3 size-4" aria-hidden />
                <Input
                  aria-label="Cerca un'identità"
                  className="pl-9"
                  placeholder="Cerca per nome, alias o regione"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select aria-label="Periodo" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Tutti i periodi</option>
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Continente"
                value={continent}
                onChange={(e) => setContinent(e.target.value)}
              >
                <option value="">Tutti i continenti</option>
                {Object.entries(CONTINENT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-muted text-xs" aria-live="polite">
              {value.identityKeys.length} selezionate
              {value.mode === "custom" ? ` su ${value.civilizationCount}` : ""}
            </p>
            {catalog.isPending ? (
              <p className="text-muted text-sm">Caricamento del catalogo…</p>
            ) : catalog.error ? (
              <p role="alert" className="text-war text-sm">
                {catalog.error.message}
              </p>
            ) : (
              <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {items.map((identity) => {
                  const selected = value.identityKeys.includes(identity.key);
                  return (
                    <li key={identity.key}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleKey(identity.key)}
                        onMouseEnter={() => setFocused(identity.key)}
                        onFocus={() => setFocused(identity.key)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                          selected ? "border-ochre bg-ochre/10" : "border-line hover:border-ochre/60",
                        )}
                      >
                        <IdentityEmblem
                          emblemKey={identity.emblemKey}
                          color={identity.primaryColor}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate">{identity.displayName}</span>
                        <span className="text-muted truncate text-xs">
                          {CONTINENT_LABELS[identity.continent]}
                        </span>
                        {selected && <Check className="text-ochre size-4" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
                {items.length === 0 && <li className="text-muted text-sm">Nessuna identità trovata.</li>}
              </ul>
            )}
          </div>
          {preview ? (
            <IdentityPreview identity={preview} />
          ) : (
            <p className="text-muted text-sm">{"Passa sopra un'identità per vederne l'anteprima."}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <p className="text-muted text-xs tracking-wide uppercase">Regole</p>
          <Toggle checked disabled>
            Livello tecnologico iniziale uniforme (utensili di pietra per tutti)
          </Toggle>
          <Toggle checked={value.equalStartingLevel} onChange={(v) => set({ equalStartingLevel: v })}>
            Stessa popolazione iniziale per ogni civiltà
          </Toggle>
          <Toggle
            checked={value.enableIdentityModifiers}
            onChange={(v) => set({ enableIdentityModifiers: v })}
          >
            Identità culturali con differenze leggere
          </Toggle>
          <Toggle checked={value.balancedPlacement} onChange={(v) => set({ balancedPlacement: v })}>
            Posizionamento geografico bilanciato
          </Toggle>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-muted text-xs tracking-wide uppercase">Sempre garantito</p>
          <Toggle checked disabled>
            Leader generati proceduralmente
          </Toggle>
          <Toggle checked disabled>
            Nessun territorio storico obbligatorio
          </Toggle>
          <Toggle checked disabled>
            Nessuna cronologia reale obbligatoria
          </Toggle>
          <Button size="sm" className="mt-1 self-start" onClick={() => onChange(competitivePreset(value))}>
            <Scale /> Preset competitivo
          </Button>
        </div>
      </div>
    </fieldset>
  );
}

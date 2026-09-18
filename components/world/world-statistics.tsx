"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CivilizationStatsPoint, StatsPoint } from "@/lib/dto";
import { api, queryKeys } from "@/lib/client/api";
import { fmtInt, fmtYear, SEASON_LABELS } from "@/lib/client/format";
import { Select } from "@/components/ui/input";

/** Categorical order validated for the dark surface (#15232a): never cycled, never rank-based. */
const SERIES = ["#bf8826", "#2fa58d", "#9a7ee0"] as const;

interface ChartDef {
  title: string;
  series: { key: keyof StatsPoint; label: string; step?: boolean }[];
}

const CHARTS: ChartDef[] = [
  { title: "Popolazione", series: [{ key: "population", label: "Abitanti" }] },
  {
    title: "Cibo prodotto e riserve",
    series: [
      { key: "foodProduced", label: "Prodotto nell'anno" },
      { key: "foodStored", label: "In magazzino" },
    ],
  },
  {
    title: "Tribù, insediamenti e civiltà",
    series: [
      { key: "tribes", label: "Tribù", step: true },
      { key: "settlements", label: "Insediamenti", step: true },
      { key: "civilizations", label: "Civiltà", step: true },
    ],
  },
  {
    title: "Saldo alimentare",
    series: [
      { key: "foodConsumed", label: "Consumato" },
      { key: "foodSurplus", label: "Surplus / deficit" },
      { key: "storageCapacity", label: "Capacità magazzini" },
    ],
  },
  { title: "Tecnologie scoperte", series: [{ key: "technologies", label: "Tecnologie", step: true }] },
  {
    title: "Sviluppo materiale",
    series: [
      { key: "buildings", label: "Edifici", step: true },
      { key: "territory", label: "Celle controllate", step: true },
      { key: "wealth", label: "Ricchezza" },
    ],
  },
  {
    title: "Commercio e migrazioni",
    series: [
      { key: "tradeVolume", label: "Scambi nell'anno" },
      { key: "migrations", label: "Persone in movimento" },
      { key: "goodsProduced", label: "Beni prodotti" },
    ],
  },
  {
    title: "Cause di morte",
    series: [
      { key: "starvationDeaths", label: "Fame" },
      { key: "conflictDeaths", label: "Conflitti" },
      { key: "epidemicDeaths", label: "Epidemie" },
    ],
  },
  {
    title: "Clima e stabilità",
    series: [
      { key: "averageTemperature", label: "Temperatura media" },
      { key: "climateStress", label: "Stress climatico" },
      { key: "averageStability", label: "Stabilità media" },
    ],
  },
  {
    title: "Conflitti",
    series: [
      { key: "wars", label: "Guerre in corso", step: true },
      { key: "battles", label: "Battaglie nell'anno" },
    ],
  },
  {
    title: "Nascite e morti per anno",
    series: [
      { key: "births", label: "Nascite" },
      { key: "deaths", label: "Morti" },
    ],
  },
];

export function WorldStatistics({
  worldId,
  civilizations = [],
}: {
  worldId: string;
  civilizations?: { id: string; name: string; color: string }[];
}) {
  const [table, setTable] = useState(false);
  const [compare, setCompare] = useState<string>("");
  const query = useQuery({
    queryKey: queryKeys.stats(worldId),
    queryFn: () => api.stats(worldId, { civilizations: true }),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {CHARTS.map((c) => (
          <Skeleton key={c.title} className="h-48" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="text-war p-4 text-sm">
        Statistiche non disponibili: {query.error.message}
      </div>
    );
  }
  const data = query.data.world;
  const civSeries = query.data.civilizations;
  if (data.length < 2) {
    return <p className="text-muted p-4 text-sm">I grafici compaiono dopo il primo anno simulato.</p>;
  }

  return (
    <div className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {civilizations.length > 0 && civSeries.length > 0 ? (
          <label className="text-muted flex items-center gap-2 text-sm">
            Confronta civiltà
            <Select
              className="h-9 w-auto"
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
              aria-label="Civiltà da confrontare"
            >
              <option value="">Nessuna</option>
              {civilizations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <span />
        )}
        <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Mostra grafici" : "Mostra tabella"}
        </Button>
      </div>
      {compare && (
        <CivilizationChart
          series={civSeries.filter((p) => p.civilizationId === compare)}
          name={civilizations.find((c) => c.id === compare)?.name ?? compare}
        />
      )}
      {table ? (
        <StatsTable data={data} />
      ) : (
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          {CHARTS.map((chart) => (
            <figure key={chart.title} className="min-w-0">
              <figcaption className="mb-1 font-serif text-base">{chart.title}</figcaption>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke="#2a3f48" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tickFormatter={fmtYear}
                      stroke="#98a5a0"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#2a3f48" }}
                      minTickGap={40}
                    />
                    <YAxis
                      stroke="#98a5a0"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickFormatter={(v: number) => fmtInt(v)}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ stroke: "#98a5a0", strokeDasharray: "3 3" }}
                      contentStyle={{
                        background: "#0f1a1f",
                        border: "1px solid #2a3f48",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#e6dcc4" }}
                      itemStyle={{ color: "#e6dcc4" }}
                      labelFormatter={(v) => `Anno ${fmtYear(Number(v))}`}
                      formatter={(value, name) => [fmtInt(Number(value)), name]}
                    />
                    {chart.series.length > 1 && (
                      <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#98a5a0" }} />
                    )}
                    {chart.series.map((s, i) => (
                      <Line
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        type={s.step ? "stepAfter" : "monotone"}
                        stroke={SERIES[i]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: "#15232a", strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-civilization comparison: population, settlements and technologies of one civilization. */
function CivilizationChart({ series, name }: { series: CivilizationStatsPoint[]; name: string }) {
  if (series.length < 2) {
    return (
      <p className="text-muted text-sm">
        Servono almeno due rilevazioni per confrontare {name}: avanza ancora il tempo.
      </p>
    );
  }
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 font-serif text-base">{name}</figcaption>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#2a3f48" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="year"
              tickFormatter={fmtYear}
              stroke="#98a5a0"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#2a3f48" }}
              minTickGap={40}
            />
            <YAxis
              stroke="#98a5a0"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => fmtInt(v)}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#0f1a1f",
                border: "1px solid #2a3f48",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: "#e6dcc4" }}
              itemStyle={{ color: "#e6dcc4" }}
              labelFormatter={(v) => `Anno ${fmtYear(Number(v))}`}
            />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#98a5a0" }} />
            <Line
              dataKey="population"
              name="Abitanti"
              type="monotone"
              stroke={SERIES[0]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="settlements"
              name="Insediamenti"
              type="stepAfter"
              stroke={SERIES[1]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="technologies"
              name="Tecnologie"
              type="stepAfter"
              stroke={SERIES[2]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function StatsTable({ data }: { data: StatsPoint[] }) {
  const rows = [...data].reverse().slice(0, 60);
  return (
    <div className="border-line max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-right text-sm">
        <caption className="sr-only">Statistiche per anno, dal più recente</caption>
        <thead className="bg-raised text-muted sticky top-0 text-xs">
          <tr>
            {[
              "Anno",
              "Stagione decisiva",
              "Abitanti",
              "Cibo prodotto",
              "Riserve",
              "Surplus",
              "Insediamenti",
              "Tecnologie",
              "Guerre",
              "Battaglie",
            ].map((h) => (
              <th key={h} scope="col" className="px-2 py-1.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tick} className="border-line/60 border-t">
              <th scope="row" className="px-2 py-1 font-serif font-normal">
                {fmtYear(r.year)}
              </th>
              <td className="px-2 py-1">{SEASON_LABELS[String(r.season)] ?? "—"}</td>
              <td className="px-2 py-1">{fmtInt(r.population)}</td>
              <td className="px-2 py-1">{fmtInt(r.foodProduced)}</td>
              <td className="px-2 py-1">{fmtInt(r.foodStored)}</td>
              <td className="px-2 py-1">{fmtInt(r.foodSurplus)}</td>
              <td className="px-2 py-1">{r.settlements}</td>
              <td className="px-2 py-1">{r.technologies}</td>
              <td className="px-2 py-1">{r.wars}</td>
              <td className="px-2 py-1">{r.battles}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

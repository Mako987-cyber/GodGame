import { buildCommunities, cellAt, createContext, createWorld, type WorldState } from "../src/index";
import type { Community, SimContext } from "../src/context";

export function world(seed = "test-seed", size = 48): WorldState {
  return createWorld({ seed, width: size, height: size });
}

export function contextWithCommunities(state: WorldState): SimContext {
  const ctx = createContext(state);
  buildCommunities(ctx);
  return ctx;
}

export function bandOf(ctx: SimContext, tribeId: string): Community {
  const band = ctx.communities.find((c) => c.tribe.id === tribeId && c.kind === "band");
  if (!band) throw new Error(`No band for ${tribeId}`);
  return band;
}

/** Turns every land cell around (x, y) into barren desert with no natural food. */
export function makeBarren(state: WorldState, x: number, y: number, radius: number) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height) continue;
      const c = cellAt(state, cx, cy);
      if (c.biome === "ocean") continue;
      c.biome = "desert";
      c.fauna = 0;
      c.maxFauna = 0;
      c.fertility = 0;
      c.baseFertility = 0;
      c.water = 0;
      c.river = false;
      c.coastal = false;
      c.habitability = 0;
    }
  }
}

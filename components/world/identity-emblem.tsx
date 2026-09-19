import {
  Anchor,
  Bird,
  Castle,
  Crown,
  Eye,
  Feather,
  Flame,
  Landmark,
  Leaf,
  Moon,
  Mountain,
  Shell,
  Shield,
  Ship,
  Star,
  Sun,
  TreePine,
  Waves,
  Wheat,
  Worm,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Abstract glyphs: never real flags or coats of arms. */
const EMBLEMS: Record<string, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  star: Star,
  wave: Waves,
  mountain: Mountain,
  tree: TreePine,
  wheat: Wheat,
  bird: Bird,
  serpent: Worm,
  landmark: Landmark,
  ship: Ship,
  tower: Castle,
  flame: Flame,
  eye: Eye,
  spiral: Shell,
  feather: Feather,
  shield: Shield,
  crown: Crown,
  leaf: Leaf,
  anchor: Anchor,
};

export function IdentityEmblem({
  emblemKey,
  color,
  size = "md",
  className,
}: {
  emblemKey: string | null | undefined;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = emblemKey ? EMBLEMS[emblemKey] : undefined;
  const box = { sm: "size-5", md: "size-7", lg: "size-10" }[size];
  const icon = { sm: "size-3", md: "size-4", lg: "size-6" }[size];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md border", box, className)}
      style={{ borderColor: color, background: `${color}26`, color }}
    >
      {Icon ? (
        <Icon className={icon} />
      ) : (
        <span className={cn("rounded-sm", icon)} style={{ background: color }} />
      )}
    </span>
  );
}

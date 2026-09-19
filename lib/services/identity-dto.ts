import type { HistoricalIdentityDefinition } from "@genesis/simulation-core";
import type { IdentitySummaryDTO } from "@/lib/validation/identity";

/** Public summary of a catalog identity: metadata only, never simulation state. */
export function toIdentitySummary(identity: HistoricalIdentityDefinition): IdentitySummaryDTO {
  return {
    key: identity.key,
    displayName: identity.displayName,
    aliases: [...identity.aliases],
    broadCategory: identity.broadCategory,
    continent: identity.continent,
    periodLabel: identity.periodLabel,
    geographicAssociations: [...identity.geographicAssociations],
    primaryColor: identity.visualProfile.primaryColor,
    secondaryColor: identity.visualProfile.secondaryColor,
    emblemKey: identity.visualProfile.emblemKey,
    culturalTags: [...identity.culturalTags],
    description: identity.description,
  };
}

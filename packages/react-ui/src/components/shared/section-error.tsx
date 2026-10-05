import { useIcons } from "../../appearance/icons.tsx";
import { cn } from "../../lib/utils.ts";
import { useLocalization } from "@kaitencloud/react";
import { Button } from "../ui/button.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import { KaitenBranding } from "./kaiten-branding.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";

export interface SectionErrorProps {
  /** Already-merged appearance (sections pass their `merged` value). */
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /** Retry callback — typically the snapshot's `refetch`. */
  onRetry?: () => void;
}

/**
 * Inline fallback for a customer-portal section whose data failed to load. Shows
 * a localized message and an optional retry, so a backend hiccup degrades to a
 * recoverable card instead of a silently blank section. Used when a section has
 * an error AND no (stale) data to fall back on.
 */
export function SectionError({ appearance, unstyled = false, onRetry }: SectionErrorProps) {
  const icons = useIcons();
  const localization = useLocalization();
  const Icon = icons.alertTriangle;

  if (unstyled) {
    return (
      <section data-slot="section-error" className="ktn-own">
        <p role="alert">{localization.states.failed}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            {localization.states.retry}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <Card className={cn("ktn-own", appearance?.elements?.card)} data-slot="section-error">
      <CardContent className="flex flex-col items-center gap-3 py-8">
        <Icon className="size-6 text-ktn-destructive" />
        <p className="text-sm text-ktn-muted-foreground" role="alert">
          {localization.states.failed}
        </p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {localization.states.retry}
          </Button>
        ) : null}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getOrganizationReviews, OrganizationReviewRow } from "@/integrations/payload/queries";
import { RatingStars } from "@/components/RatingStars";
import { ReportReviewAction } from "@/components/ReportReviewAction";
import { Button } from "@/components/ui/button";

const SHOWN_AT_FIRST = 5;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });

/** What participants wrote about the organization's events, one by one and without their names —
 * newest first, each reportable to the obec when it's unfair. */
export function OrganizationReviews({ organizationId }: { organizationId: string }) {
  const [reviews, setReviews] = useState<OrganizationReviewRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = () =>
    getOrganizationReviews(organizationId)
      .catch(() => [] as OrganizationReviewRow[])
      .then(setReviews);

  useEffect(() => {
    setReviews(null);
    setShowAll(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  if (!reviews || reviews.length === 0) return null;

  const shown = showAll ? reviews : reviews.slice(0, SHOWN_AT_FIRST);

  return (
    <section className="space-y-2">
      <h3 className="font-bold">Recenze akcí</h3>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {shown.map((r) => (
          <li key={r.id} className="space-y-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RatingStars value={r.satisfaction} size="sm" label="Spokojenost" />
              <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
            </div>
            {r.comment && <p className="text-sm whitespace-pre-line break-words">„{r.comment}“</p>}
            <p className="text-xs text-muted-foreground">
              <Link href={`/akce/${r.event_id}`} className="hover:underline">
                {r.event_title}
              </Link>
            </p>
            <ReportReviewAction
              type="event-feedback"
              reviewId={r.id}
              status={r.complaint_status}
              canComplain={r.can_complain}
              onReported={load}
            />
          </li>
        ))}
      </ul>
      {reviews.length > SHOWN_AT_FIRST && (
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Zobrazit méně" : `Zobrazit všechny recenze (${reviews.length})`}
        </Button>
      )}
    </section>
  );
}

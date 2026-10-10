import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Bell, FileX, Home } from "lucide-react";

// Where /api/exports/:id/download sends a browser it can't hand a file to — the link in a
// "Report je připraven" notification or e-mail outlives the file itself.
const REASONS: Record<string, { title: string; description: string }> = {
  expired: {
    title: "Platnost reportu vypršela",
    description: "Soubor už jsme smazali. Vygenerujte ho prosím znovu tam, kde jste o něj požádali.",
  },
  pending: {
    title: "Report ještě není hotový",
    description: "Jakmile bude připravený, pošleme vám oznámení. Zkuste to prosím za chvíli.",
  },
  missing: {
    title: "Report nebyl nalezen",
    description: "Tento report neexistuje nebo k němu nemáte přístup.",
  },
};

export default async function ExportUnavailablePage({ searchParams }: { searchParams: Promise<{ duvod?: string }> }) {
  const { duvod } = await searchParams;
  const reason = REASONS[duvod ?? ""] ?? REASONS.missing;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Report" />
      <EmptyState
        icon={FileX}
        title={reason.title}
        description={reason.description}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link href="/oznameni"><Bell className="h-4 w-4" /> Oznámení</Link>
            </Button>
            <Button asChild className="h-11">
              <Link href="/"><Home className="h-4 w-4" /> Na úvod</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}

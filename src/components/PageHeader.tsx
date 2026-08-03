"use client";

import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  /** Vlastní akce vpravo */
  right?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, back, right, className }: PageHeaderProps) {
  const router = useRouter();
  return (
    <header className={cn("sticky top-0 z-30 bg-background/90 backdrop-blur px-4 pt-4 pb-3 border-b border-border", className)}>
      <div className="flex items-center gap-2">
        {back && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="-ml-2 h-11 w-11 shrink-0"
            aria-label="Zpět"
          >
            <ChevronLeft className="h-7 w-7" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-3xl leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}

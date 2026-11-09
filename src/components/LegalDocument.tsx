import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { LEGAL_DOCUMENT_VERSION, legalIsDraft } from '@/lib/legal'

/** Frame of the public legal pages: readable column, a way back, and the draft notice while the
 * operator's details are still placeholders (lib/legal). */
export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8 pb-16">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Zpět na Lonvitu
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Verze {LEGAL_DOCUMENT_VERSION}</p>
      {legalIsDraft && (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Pracovní znění — údaje o provozovateli a konečné znění ještě nejsou doplněné a schválené.
        </p>
      )}
      <div className="mt-6 space-y-6 leading-relaxed [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </main>
  )
}

import Link from 'next/link'

import { LegalDocument } from '@/components/LegalDocument'
import { LEGAL_ENTITY } from '@/lib/legal'

import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Podmínky používání' }

export default function TermsPage() {
  return (
    <LegalDocument title="Podmínky používání Lonvity">
      <p>
        Lonvita je komunitní platforma obcí: akce, dobrovolnictví a spolky na jednom místě. Provozuje ji{' '}
        {LEGAL_ENTITY.name}, {LEGAL_ENTITY.address}, IČO {LEGAL_ENTITY.idNumber} (dále „provozovatel“). Registrací nebo
        přihlášením tyto podmínky přijímáte.
      </p>

      <section>
        <h2>Účet</h2>
        <ul>
          <li>Účet může mít osoba, které je alespoň 15 let. Registrací to potvrzujete.</li>
          <li>Údaje v profilu uvádějte pravdivě. Za zneužití přihlašovacích údajů odpovídáte, pokud jste je nechránili.</li>
          <li>Účet můžete kdykoli smazat v profilu. Smazat ho nelze, dokud pořádáte akce, které ještě neproběhly, nebo
            jste jediným správcem obce.</li>
        </ul>
      </section>

      <section>
        <h2>Pravidla pro obsah a akce</h2>
        <ul>
          <li>Pořadatelé zveřejňují jen akce, které opravdu pořádají, a odpovídají za pravdivost jejich popisu, kapacity
            a termínu.</li>
          <li>Je zakázáno zveřejňovat nezákonný, urážlivý nebo klamavý obsah a cizí osobní údaje bez právního důvodu.</li>
          <li>Hodnocení musí být pravdivé a věcné. Obec může nevhodné hodnocení na základě stížnosti odstranit.</li>
          <li>Provozovatel nebo správce obce může obsah, který pravidla porušuje, odstranit a účet omezit.</li>
        </ul>
      </section>

      <section>
        <h2>Přihlášky na akce</h2>
        <p>
          Přihláška je závazná pro obě strany do chvíle, kdy ji zrušíte, nebo pořadatel akci zruší. Při zrušení či
          změně akce vás upozorníme e-mailem, v aplikaci a případně SMS. Pořadatel může evidovat vaši účast a
          spolehlivost (omluvené i neomluvené neúčasti).
        </p>
      </section>

      <section>
        <h2>Dostupnost a odpovědnost</h2>
        <p>
          Službu poskytujeme tak, jak je, a snažíme se o nepřetržitý provoz; nezaručujeme ho a může být omezen kvůli
          údržbě nebo výpadku našich dodavatelů. Za obsah akcí a jejich průběh odpovídají pořadatelé, ne provozovatel.
          Odpovědnost provozovatele za škodu se řídí zákonem.
        </p>
      </section>

      <section>
        <h2>Osobní údaje</h2>
        <p>
          Jak nakládáme s osobními údaji, popisují{' '}
          <Link href="/zasady-ochrany-osobnich-udaju" className="underline underline-offset-2">
            Zásady ochrany osobních údajů
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>Změny podmínek</h2>
        <p>
          Podmínky můžeme změnit; o podstatné změně vás předem informujeme v aplikaci nebo e-mailem. Pokud s novým
          zněním nesouhlasíte, můžete účet smazat. Podmínky se řídí českým právem.
        </p>
        <p>Dotazy: {LEGAL_ENTITY.privacyEmail}.</p>
      </section>
    </LegalDocument>
  )
}

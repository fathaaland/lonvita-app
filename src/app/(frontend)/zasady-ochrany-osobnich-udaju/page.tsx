import { LegalDocument } from '@/components/LegalDocument'
import { LEGAL_ENTITY, PROCESSORS } from '@/lib/legal'
import { RETENTION } from '@/lib/retention/policy'

import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Zásady ochrany osobních údajů' }

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument title="Zásady ochrany osobních údajů">
      <p>
        Tyto zásady vysvětlují, jaké osobní údaje Lonvita zpracovává, proč, jak dlouho a komu je předává (nařízení
        (EU) 2016/679, GDPR, čl. 13).
      </p>

      <section>
        <h2>Kdo je správce</h2>
        <p>
          {LEGAL_ENTITY.name}, {LEGAL_ENTITY.address}, IČO {LEGAL_ENTITY.idNumber}. Se vším kolem svých údajů se na nás
          můžete obrátit na {LEGAL_ENTITY.privacyEmail}.
        </p>
        <p>
          Obec, v jejímž okruhu platformu používáte, vidí údaje o přihlášených na své akce a o dobrovolnících ve své
          obci. Pořadatel akce vidí přihlášené na svou akci.
        </p>
      </section>

      <section>
        <h2>Jaké údaje a proč</h2>
        <ul>
          <li>
            <strong>Účet a přihlášení</strong> — e-mail, heslo (uložené jen jako nevratný otisk), případně identifikátor
            účtu Google. Důvod: smlouva o poskytování služby.
          </li>
          <li>
            <strong>Profil</strong> — jméno, telefon, datum narození, pohlaví, zájmy, domovská obec, fotografie.
            Datum narození slouží k přehledům obce (např. podíl obyvatel nad 50 let); telefon k SMS a k tomu, aby vás
            pořadatel zastihl. Důvod: smlouva; fotografii nahráváte dobrovolně a můžete ji kdykoli odstranit.
          </li>
          <li>
            <strong>Účast na akcích</strong> — přihlášky, docházka, hodnocení akcí a dobrovolníků, spolehlivost.
            Důvod: smlouva a oprávněný zájem obce a pořadatelů vést přehled o akcích.
          </li>
          <li>
            <strong>Zprávy</strong> — oznámení v aplikaci, e-maily a SMS o akcích, na které jste přihlášeni. Novinky
            e-mailem jen s vaším souhlasem.
          </li>
          <li>
            <strong>Záznamy o činnosti</strong> — přihlášení, odhlášení, neúspěšné pokusy, změny oprávnění a dat, vždy
            s časem, IP adresou a prohlížečem. Důvod: povinnost zajistit bezpečnost a dohledatelnost (zákon č.
            264/2025 Sb. a vyhláška č. 409/2025 Sb.), oprávněný zájem na ochraně služby.
          </li>
        </ul>
      </section>

      <section>
        <h2>Jak dlouho údaje uchováváme</h2>
        <ul>
          <li>Účet a profil — dokud účet nesmažete. Po smazání se jméno, kontakty, fotografie a heslo odstraní; zůstane
            anonymní záznam, aby statistiky obce zůstaly správné.</li>
          <li>Zrušené nebo nerozhodnuté přihlášky a zrušené akce — {RETENTION.staleEventDataMonths} měsíců po konání akce.</li>
          <li>Oznámení v aplikaci — {RETENTION.notificationReadDays} dní po přečtení, nepřečtená {RETENTION.notificationDays} dní.</li>
          <li>Vyřízené žádosti a pozvánky — {RETENTION.decidedRequestDays} dní po začátku akce.</li>
          <li>Technické záznamy — {RETENTION.systemLogDays} dní; bezpečnostní události (přihlášení) {RETENTION.securityEventMonths} měsíců.</li>
          <li>Záznam o změnách v systému (audit) — {RETENTION.auditLogMonths} měsíců; jeho neměnná kopie mimo aplikaci
            nejméně {RETENTION.auditExportMonths} měsíců, jak ukládá vyhláška č. 409/2025 Sb.</li>
          <li>Soubory ke stažení (reporty) — 7 dní.</li>
        </ul>
      </section>

      <section>
        <h2>Komu údaje předáváme</h2>
        <p>Služby, které pro nás údaje zpracovávají (zpracovatelé), a servery, se kterými komunikuje váš prohlížeč:</p>
        <ul>
          {PROCESSORS.map((processor) => (
            <li key={processor.name}>
              <strong>{processor.name}</strong> — {processor.purpose} ({processor.where}).
            </li>
          ))}
        </ul>
        <p>
          Při předání mimo EU se opíráme o rozhodnutí Evropské komise o odpovídající ochraně (rámec EU–USA pro ochranu
          soukromí) nebo o standardní smluvní doložky. Údaje neprodáváme a nepoužíváme je k reklamě.
        </p>
      </section>

      <section>
        <h2>Vaše práva</h2>
        <p>
          Máte právo na přístup ke svým údajům a jejich kopii, na opravu, výmaz, omezení zpracování, přenositelnost a
          právo vznést námitku. Údaje si opravíte v profilu. Účet smažete v profilu tlačítkem „Smazat účet“. Souhlas s
          novinkami můžete kdykoli odvolat v nastavení notifikací. O kopii údajů nebo cokoli dalšího nám napište na{' '}
          {LEGAL_ENTITY.privacyEmail}; odpovíme do jednoho měsíce.
        </p>
        <p>
          Máte také právo podat stížnost u Úřadu pro ochranu osobních údajů (Pplk. Sochora 27, 170 00 Praha 7,{' '}
          uoou.gov.cz).
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          Používáme jen technické cookies nezbytné pro přihlášení a bezpečnost (relace, identifikátor požadavku pro
          dohledání chyb). Nastavení vzhledu (velikost písma, kontrast, tmavý režim) zůstává jen ve vašem prohlížeči. Neměříme návštěvnost reklamními nástroji ani vás
          nesledujeme napříč weby.
        </p>
      </section>
    </LegalDocument>
  )
}

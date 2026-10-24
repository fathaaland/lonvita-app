import { redirect } from 'next/navigation'

/** Importing events is the obec's — in Přehled obce. Kept for links in older notifications. */
export default function ImportPage() {
  redirect('/admin-obce?tab=import')
}

import type { MetadataRoute } from 'next'

/** "Přidat na plochu" — opens like an app, with the brand's colours (globals.css --brand-ivory). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lonvita',
    short_name: 'Lonvita',
    description: 'Komunitní platforma obce — akce, dobrovolnictví a spolky na jednom místě.',
    lang: 'cs',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9efe7',
    theme_color: '#f9efe7',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}

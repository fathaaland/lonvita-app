import type { MetadataRoute } from 'next'

/**
 * What search engines may crawl: the events and the public pages. Not the account, admin and API
 * pages — behind a sign-in anyway, and nothing to index there. Previews (Vercel) aren't indexed at
 * all: they'd compete with the real site.
 */
export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/admin-obce',
        '/superadmin',
        '/profil',
        '/moje-akce',
        '/oznameni',
        '/organizace',
        '/dobrovolnik',
        '/onboarding',
        '/reset-password',
        '/import',
        '/spravovat',
        '/upravit',
        '/vytvorit',
        '/export-nedostupny',
      ],
    },
    ...(appUrl ? { sitemap: `${appUrl}/sitemap.xml` } : {}),
  }
}

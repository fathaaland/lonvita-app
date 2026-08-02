export const AUTH0_PROVIDERS = {
  DATABASE: 'auth0',
  GOOGLE: 'google-oauth2',
} as const

export type Auth0ProviderCode = (typeof AUTH0_PROVIDERS)[keyof typeof AUTH0_PROVIDERS]

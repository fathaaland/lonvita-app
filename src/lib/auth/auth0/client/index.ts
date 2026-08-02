import { Auth0Client } from '@auth0/nextjs-auth0/server'

export const AUTH0_CALLBACK_PATH = process.env.AUTH0_CALLBACK!

export const auth0 = new Auth0Client({
  appBaseUrl: process.env.AUTH0_BASE_URL!,
  routes: {
    callback: AUTH0_CALLBACK_PATH,
  },
  authorizationParameters: {
    scope: 'openid profile email',
  },
})

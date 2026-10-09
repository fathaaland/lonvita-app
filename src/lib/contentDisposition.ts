import { toUSVString } from 'node:util'

const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]', 'g')

/**
 * A `Content-Disposition` value for a file name that comes from user input (an event or obec
 * name in an export's title). Keeps Czech names readable — `filename*` carries the UTF-8 original —
 * while nothing in it can split the header, smuggle a path, or flip the displayed text with a
 * bidi override; `filename` is the plain-ASCII fallback for clients that ignore `filename*`.
 */
export const contentDisposition = (fileName: string, disposition: 'attachment' | 'inline' = 'attachment'): string => {
  const baseName = toUSVString(fileName).split(/[\\/]/).at(-1) ?? ''
  const safeName = baseName.replace(CONTROL_CHARACTERS, '').trim().replace(/^\.+$/, '') || 'soubor'
  const asciiName = safeName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\%;]/g, '_')
  // encodeURIComponent leaves these alone, but RFC 8187 doesn't allow them unescaped.
  const encodedName = encodeURIComponent(safeName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
}

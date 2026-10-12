/**
 * A relationship field reads back as the related id or — populated, at depth ≥ 1 — as the related
 * document. These take the id out of either shape. Shared by the collections, the API routes, the
 * worker and the browser's query layer.
 */

type Populated = { id: unknown }

const idOf = (value: unknown): unknown => (typeof value === 'object' && value !== null ? (value as Populated).id : value)

/** The id as text — what Sets, Maps and comparisons across both shapes key on. Null when unset. */
export const relationId = (value: unknown): string | null => (value == null ? null : String(idOf(value)))

/** The id as a number — what a query or a relationship write takes. Null when unset. */
export const relationNumber = (value: unknown): number | null => (value == null ? null : Number(idOf(value)))

/** relationNumber for a relationship that is always set (a required field) — typed as a plain number. */
export const requiredRelationNumber = (value: unknown): number => relationNumber(value) as number

/** The id as text, an unset one included ("null", "undefined") — for code that gathers ids into a
 * set and drops those two afterwards, or keys a map by whatever is there. */
export const relationKey = (value: unknown): string => String(idOf(value))

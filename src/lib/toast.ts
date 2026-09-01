/**
 * What a mutation says afterwards.
 *
 * The prototype raises one of these on every mutation, and the copy explains
 * the *consequence* rather than narrating the action — "it sits with the
 * coordinator until the numbers move", not "flag saved". Server actions
 * return one; the toast layer in src/components/Toast.tsx shows it.
 *
 * Kept out of `server-only` so both sides of the boundary can hold the type.
 */

export type ToastKind = 'good' | 'warn' | 'stop'

export interface Said {
  kind: ToastKind
  text: string
}

export const said = (text: string, kind: ToastKind = 'good'): Said => ({ kind, text })

import { redirect } from 'next/navigation'

/** The parent of every position detail URL. Holdings is the list it belongs to. */
export default function PositionsIndex(): never {
  redirect('/holdings')
}

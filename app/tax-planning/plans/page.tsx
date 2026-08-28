import { redirect } from 'next/navigation'

/**
 * `/tax-planning/plans` had no page, so trimming the id off a plan URL — or
 * following the parent of a detail route — landed on "no such page".
 *
 * This redirects rather than listing. /tax-planning already renders every saved
 * plan in SavedPlansPanel, and a second list here would be the duplication this
 * refactor exists to remove.
 */
export default function SavedPlansIndex(): never {
  redirect('/tax-planning')
}

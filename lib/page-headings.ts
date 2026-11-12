/**
 * The headings of the routes outside the sidebar, as pure functions.
 *
 * A sidebar route's heading is a fixed copy string, so tests/page-headings.test.ts
 * reads it straight from the copy module. These five routes build theirs from
 * data (an id, an instrument name, a saved plan's name), so the page and the test
 * both call the function here: the test then checks the heading the page actually
 * renders, without importing a page component.
 *
 * `emphasis`, when present, must be a trailing substring of `title` — that is the
 * only way PageHeader applies the brand gradient.
 */
export type Heading = { title: string; emphasis: string | undefined }

/**
 * /rebalance/proposals/[id]. The id follows the title, so the emphasis carries
 * the id too: "proposal" alone is not the end of "Rebalance proposal <id>", and
 * the gradient never rendered.
 */
export function proposalHeading(copy: { title: string; emphasis: string }, id: string): Heading {
  return { title: `${copy.title} ${id}`, emphasis: `${copy.emphasis} ${id}` }
}

/**
 * /positions/[market]/[ticker]. The instrument name, with no emphasis: the
 * ticker used as emphasis was never the end of the name. The header redesign in
 * a later phase decides the final shape.
 */
export function positionHeading(name: string): Heading {
  return { title: name, emphasis: undefined }
}

/** /tax-planning/plans/[id]. The saved plan's own name, with no emphasis. */
export function savedPlanHeading(name: string): Heading {
  return { title: name, emphasis: undefined }
}

/** /taxes/records/[id]. A fixed title with no emphasis. */
export function taxRecordHeading(copy: { recordTitle: string }): Heading {
  return { title: copy.recordTitle, emphasis: undefined }
}

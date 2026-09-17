/**
 * Where the signed-in shell trades its sidebar for a top bar and a menu sheet.
 *
 * Below 1024px — phones either way up, and tablets held upright — the module
 * nav moves into a sheet and the page gets the full width. From 1024px up it
 * is the sidebar, as the design handoff draws it.
 *
 * A media query cannot read a custom property, so each stylesheet that
 * switches on this writes the query out in full, and shell.test.ts holds them
 * to this string. The menu sheet reads it too, to close itself if the window
 * widens past it.
 */
export const COMPACT_SHELL = '(max-width: 1023px)'

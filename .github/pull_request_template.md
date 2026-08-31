## What this changes

<!-- One or two sentences. Link the request from the team's feature-request
     sheet if this came from there (REQ-nnn). -->

## How it was verified

<!-- Delete what does not apply. "CI is green" alone is not verification for
     anything touching money, permissions or hours. -->

- [ ] `npm run check` passes locally
- [ ] New behaviour has a test that fails without the change
- [ ] Checked signed in as each role the change affects
- [ ] Finance figures reconciled against a real settlement

## Risk

<!-- Tick anything this touches. These get a second reviewer. -->

- [ ] Money — settlement, wages, splits, invoicing, Xero
- [ ] Permissions — roles, module access, external promoter scoping
- [ ] Hours — rostering, timesheets, anything feeding the profit share
- [ ] Migrations — schema changes, data backfills
- [ ] None of the above

## Claude's involvement

<!-- Be honest — this changes how closely it gets read, not whether it lands. -->

- [ ] Written by Claude, reviewed by me line by line
- [ ] Written by me, Claude assisted
- [ ] Written by me

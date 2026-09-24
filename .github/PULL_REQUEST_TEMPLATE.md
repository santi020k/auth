## Outcome

Describe the user-visible or operational result of this pull request.

## Verification

- [ ] `pnpm verify`
- [ ] Relevant browser, migration, or deployment evidence is included
- [ ] No secret, email code, identity data, or production record appears in the diff or logs

## Release and data safety

- [ ] Package-facing changes include a Changeset, or this PR is labeled `skip-changelog`
- [ ] Schema changes are additive, app-owned, and tested against existing data
- [ ] Release PRs include migration notes plus rollback or forward-recovery steps
- [ ] Authentication state remains isolated per consumer

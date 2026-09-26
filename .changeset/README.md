# Changesets

Every change to a published package's public API or behaviour adds a changeset
(`pnpm changeset`); a breaking change is `major` and needs an ADR (NFR-MNT-007).
Packages publish with `access: public` and npm provenance (`publishConfig` in each library's
`package.json`; `release.yml` publishes through OIDC).

# Release Process

This page documents the normal Mindwtr release flow at a practical level. It is intended for maintainers working from the repository.

---

## Source Files

Release automation and version metadata are centered in:

- `scripts/bump-version.sh`
- `scripts/update-versions.js`
- `docs/release-notes/`
- `docs/release-notes/google-play/`
- `metadata/`
- `metadata/metadata.json`
- `apps/desktop/src-tauri/linux/Mindwtr.metainfo.xml`
- `https://github.com/dongdongbh/mindwtr-web/tree/main/docs` for public docs changes
- `wiki/` only for legacy GitHub Wiki pages that still need mirroring
- `.github/workflows/`

---

## Standard Release Flow

1. Make sure `main` is in the intended release state and commit any pre-release work first.
   - If the previous version is already released, put follow-up fixes under `docs/release-notes/unreleased.md` and link it from `CHANGELOG.md` until the next patch version is prepared, for example `v0.9.1` after `v0.9.0`.
2. Bump the version with:

```bash
./scripts/bump-version.sh 0.x.y
```

This updates workspace package versions and bumps the Android `versionCode`.

3. Run the release hard gates before tagging:
   - Type/test gate:
     - `bun run test`
     - `bun run typecheck`
     - `bun run native:test`
   - FOSS/static gate:
     - inspect `git diff vPREV..HEAD -- apps/mobile/package.json`
     - inspect F-Droid/FOSS config files (`apps/mobile/plugins/android-manifest-fixes.js`, `apps/mobile/scripts/`, `.github/workflows/release-android-foss.yml`, `config/izzyonandroid.yml`)
     - run `python3 scripts/ci/repair-package-lock.py --check apps/desktop/package-lock.json`
   - CloudKit schema gate:
     - inspect synced schema files against the previous tag
     - if a new CloudKit-backed field or record type was added, update/deploy the production schema before release
4. Prepare or update release notes and metadata:
   - `docs/release-notes/<version>.md`
   - `docs/release-notes/google-play/<version>.txt`
   - `metadata/*/release_notes.txt`
   - `metadata/*/changelogs/<androidVersionCode>.txt`
   - `metadata/metadata.json`
   - `apps/desktop/src-tauri/linux/Mindwtr.metainfo.xml`
5. Update public docs in the [Mindwtr web docs source](https://github.com/dongdongbh/mindwtr-web/tree/main/docs) when release/docs process details changed. Update `wiki/` only for legacy GitHub Wiki pages that still need mirroring. Do not run git in a separate `.wiki` checkout.
6. Review the resulting version and metadata changes carefully.
7. Commit the release prep:

```bash
git add -A
git commit -m "chore(release): v0.x.y"
```

8. Tag the release:

```bash
git tag v0.x.y
```

9. Push `main` and the tag:

```bash
git push origin main --tags
```

10. Let GitHub Actions publish the platform artifacts and any downstream packaging jobs.

---

## Before Tagging

At minimum, verify:

- release notes exist and match the actual changes
- package versions are aligned across the monorepo
- Android `versionCode` was incremented
- desktop package lock passes `repair-package-lock.py --check`
- FOSS config still strips blocked permissions and keeps only intentional ones
- CloudKit-backed schema did not change, or the production schema was updated first
- store/release metadata changes are intentional and scoped per platform
- mobile store categories in the consoles are still correct: Google Play `Productivity > Task Management` and App Store primary category `Productivity`
- Google Play locale bodies fit the 500-character API limit

For larger releases, also verify:

- desktop updater metadata
- mobile store metadata / Fastlane inputs
- docs-site changes for user-visible features in the [Mindwtr web docs source](https://github.com/dongdongbh/mindwtr-web/tree/main/docs)
- cross-backend sync smoke with a small seed dataset: add, update, delete, and attachment transfer should converge across Cloud, WebDAV/file sync, and any platform-native backend available to the release tester; a second sync should report no new conflicts

---

## Release Notes

Versioned release notes live in `docs/release-notes/`.

Guidelines:

- keep the top summary user-facing
- include the important fixes/features first
- list notable commits when helpful
- keep Google Play snippets in `docs/release-notes/google-play/` aligned when needed
- update `metadata/*/release_notes.txt` for App Store release notes
- add the new Android changelog file under `metadata/*/changelogs/<versionCode>.txt`
- keep Microsoft Store release notes in `metadata/metadata.json` aligned with the same release
- add or refresh the top AppStream entry in `apps/desktop/src-tauri/linux/Mindwtr.metainfo.xml`

---

## Post-Release Checks

After the tag is pushed:

- verify GitHub release creation
- verify expected desktop/mobile artifacts are attached
- verify store-specific workflows succeeded when applicable
- spot-check the updater/download surfaces against the new version

---

## Rollback Mindset

If a bad release is detected:

- stop follow-up tagging until the failure mode is understood
- prefer a fast forward fix release over rewriting published history
- keep release notes explicit about the corrective patch

---

## Related

- [[Developer Guide]]
- [[Docker Deployment]]
- [[Cloud Deployment]]
- [Repository release notes](https://github.com/dongdongbh/Mindwtr/tree/main/docs/release-notes)

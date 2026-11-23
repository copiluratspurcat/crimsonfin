# CrimsonFin v1.0.8 — Workflow repair

Both build jobs in v1.0.7 failed at a legacy verification step that still expected `build.publish.owner` and `build.publish.repo` to point to the old public downloads repository. That check is no longer valid after changing to private releases on the main repository.

This version validates only that the tag matches `package.json` and publishes `.exe` and `.deb` to the current private repository with `GITHUB_TOKEN`. No external publishing PAT is required.

Before tagging, compare `.github/workflows/release.yml` and check that the old `Verify release version and destination` step is absent. Tag as `v1.0.8`.

# CrimsonFin v1.0.5 — Release publishing correction

- Replaced the failing inline Bash/gh publication step with `softprops/action-gh-release@v3`.
- Publishes artifacts to the separate public `copiluratspurcat/crimsonfin-downloads` repository using `DOWNLOADS_RELEASE_TOKEN`.
- Preserves Windows NSIS, Linux DEB/AppImage and update metadata generation.
- No application UI or playback changes in this release.

**Note:** Publishing requires the repository secret to be configured with write access to the downloads repository. The workflow is validated statically; publishing requires a GitHub Actions run.

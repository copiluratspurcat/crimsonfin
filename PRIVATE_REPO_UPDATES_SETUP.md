# CrimsonFin v1.0.2: private source, public installer downloads

## Fix included
On Windows, custom minimize/maximize/close buttons now occupy a dedicated top row; search, sound toggle and user avatar are in the lower header row. Native title-bar overlay is disabled on Windows to prevent duplicate/overlapping controls. The version is now 1.0.2.

## GitHub setup (one-time)
1. Create a **public** repository `copiluratspurcat/crimsonfin-downloads` (with a README). It contains only release installers and updater YAML, not the source. The repository/release URL is **not link-only private**: anyone can discover and download its public releases.
2. In that public repo's Settings > Actions > General, no release workflow is needed.
3. Create a **fine-grained personal access token** with resource owner `copiluratspurcat`, *only* `crimsonfin-downloads` repository, **Contents: Read and write**. An expiry date is recommended. Do not put it in the code or send it to anyone.
4. In the **private source repository** `crimsonfin`, go to Settings > Secrets and variables > Actions > New repository secret. Name it **DOWNLOADS_RELEASE_TOKEN** and paste the token there.
5. Make `crimsonfin` private in Settings > General > Danger Zone > Change repository visibility. This does not protect any source files already cloned or downloaded, and public forks/archives might remain accessible elsewhere.

## Deploy this source update on Debian
```bash
cp -a ~/Videos/CrimsonFin-v1.0.2-Private-Updates/. ~/Videos/CrimsonFin-v0.6-GitHub-Windows-Linux/
cd ~/Videos/CrimsonFin-v0.6-GitHub-Windows-Linux
npm install
npm start
git add -A
git commit -m 'CrimsonFin v1.0.2 Windows header and public updater feed'
git push origin main
git tag v1.0.2
git push origin v1.0.2
```

GitHub Actions in the PRIVATE source repository builds both OS installers, downloads both jobs' artifacts and publishes a release in the PUBLIC `crimsonfin-downloads` repository with the secret. See Actions logs. The workflow intentionally does not copy source files.

## Testing automatic updates
- Install `v1.0.2` from the public download repository (Windows NSIS or Linux AppImage). It embeds the public updater feed.
- Publish `v1.0.3` with a source `package.json` version of `1.0.3` and tag `v1.0.3` to verify the updater from `v1.0.2`.
- Existing installed versions from v1.0.1 or earlier point to `copiluratspurcat/crimsonfin`. They cannot automatically switch to the new update feed after the old repository becomes private. **Manually install v1.0.2 once** (or release a migration build before hiding the old public releases).
- `.deb` does not auto-update via electron-updater; reinstall a later .deb manually.
- GitHub-hosted public downloads are not a restricted invitation-only or unlisted mechanism. Use a private authenticated distribution system for access control.

## Security / release notes
- Do not embed the PAT in the Electron client. It is only used in GitHub Actions as an encrypted repository secret.
- For production public distribution, code signing (Windows) and signing/verifying release metadata are strongly recommended. Unsigned installs can show Windows SmartScreen warnings.
- After setting your private repo, public-release assets remain independently accessible. Jellyfin credentials are still required.
- Verify actual Windows release and updater behavior; source changes here are not a guarantee of working packaged app.

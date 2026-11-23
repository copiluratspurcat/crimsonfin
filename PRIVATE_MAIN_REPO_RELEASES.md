# CrimsonFin v1.0.6 — private main-repository releases

This variant publishes ONLY `.exe` and `.deb` installers to **Releases** on `copiluratspurcat/crimsonfin` (the private source repository). It no longer publishes AppImages or update feeds, and does not need `DOWNLOADS_RELEASE_TOKEN`. GitHub Actions uses the built-in `GITHUB_TOKEN` for the current repository.

## Setup

1. Keep `crimsonfin` private.
2. In its **Settings → Actions → General → Workflow permissions**, set **Read and write permissions** for the workflow token, if needed. The workflow also explicitly requests `contents: write`.
3. Replace the old project files with v1.0.6 and commit them to `main`.
4. Create and push `v1.0.6` once. GitHub Actions builds both packages and publishes them to the **Releases** tab of the same repository.

## Publish

```bash
cd ~/Videos/CrimsonFin-v0.6-GitHub-Windows-Linux
git add -A
git commit -m 'CrimsonFin v1.0.6 - private repo releases'
git push origin main
git tag v1.0.6
git push origin v1.0.6
```

## Access and updates

A private repository is NOT link-accessible to everyone. Only you and explicitly invited collaborators can download its private release assets. The automatic updater is disabled for this variant because a generic installed application cannot anonymously fetch private release assets, and embedding a repository token in it would be unsafe. To update: download the new installer from Releases and install it. If you later want anonymous users to download and auto-update, a separate **public binary release repository** remains the correct architecture.

**Security:** Revoke `DOWNLOADS_RELEASE_TOKEN` (and the PAT backing it) if it is no longer needed. If a token is visible in a screenshot that is shared, rotate it.

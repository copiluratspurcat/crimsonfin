# CrimsonFin v1.0.7 — in-place installer upgrades

## Windows (NSIS)
The installer uses the stable `appId` `com.crimsonfin.desktop` and `productName` `CrimsonFin`. It is configured as an assisted NSIS installer with installation-directory changes disabled, to favor upgrades in the existing location over side-by-side installations. Installing a newer build over a matching previous NSIS installation should replace its application files without removing settings stored in the user profile. Close CrimsonFin before running the installer.

The installer **does not search for or delete downloaded old `.exe` files** in Downloads or elsewhere. It also cannot promise removal of unrelated portable installs, manually copied folders, or earlier builds with different app identifiers/install paths.

## Debian 13 (.deb)
The package name remains `crimsonfin`. Using `sudo apt install ./CrimsonFin-1.0.7-Linux-amd64.deb` upgrades the installed DEB package of the same name, replacing old package files and preserving user settings outside the package. Debian does not automatically delete previously downloaded `.deb` files.

## Before release
Install v1.0.6 and then v1.0.7 on a test machine to confirm the upgrade does not leave a second installation. Check shortcuts, retained sign-in/settings, and that Help/Settings/footer shows v1.0.7. Old `npm start` source folders are unaffected.

## Security / distribution
The GitHub Release is in a private repository. Only users with repository access can download it. Automatic app updates remain disabled; the installers perform in-place upgrades when users run them manually.

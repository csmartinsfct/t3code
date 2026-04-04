# production-build

Build a production macOS ARM64 desktop DMG and open it for installation.

## Steps

1. Run the build artifact script:

```bash
bun run scripts/build-desktop-artifact.ts --platform mac --arch arm64 --verbose
```

2. Open the resulting DMG:

```bash
open release/T3-Code-*.dmg
```

The DMG will be output to the `release/` directory at the repo root. Drag "T3 Code (Alpha)" to Applications to install.

## Notes

- This uses `electron-builder` under the hood via `scripts/build-desktop-artifact.ts`
- The script automatically runs `bun build:desktop` first (contracts, server, web, desktop bundles)
- The build is unsigned (ad-hoc signature) for local development
- For x64 builds, pass `--arch x64` instead
- For other platforms: `--platform linux` or `--platform win`
- Output artifacts land in `release/` (or `release-mock/` with `--mock-updates`)

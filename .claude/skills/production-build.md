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
- Staged production dependencies are installed with Bun's target `--os` / `--cpu`
  flags so native optional dependencies, including the Claude Agent SDK binary,
  match the requested artifact arch rather than the build host.
- Claude is pinned to `@anthropic-ai/claude-agent-sdk` `0.3.207`, whose package
  metadata bundles Claude Code `2.1.207`. The SDK declares eight native optional
  packages: glibc and musl Linux arm64/x64, macOS arm64/x64, and Windows
  arm64/x64. For macOS, target staging must install the matching
  `@anthropic-ai/claude-agent-sdk-darwin-arm64` or
  `@anthropic-ai/claude-agent-sdk-darwin-x64` package and its top-level `claude`
  executable.
- The default Claude configuration lets the SDK resolve that bundled native
  executable. A configured binary path is passed as
  `pathToClaudeCodeExecutable` and intentionally overrides it.
- Before upgrading the Claude SDK pin, review its changelog, peer requirements,
  exported runtime contract, bundled Claude Code version, and native package
  layout. For `0.3.207` the peers are `@anthropic-ai/sdk >=0.93.0`,
  `@modelcontextprotocol/sdk ^1.29.0`, and `zod ^4`.
- The build is unsigned (ad-hoc signature) for local development
- For x64 builds, pass `--arch x64` instead
- For other platforms: `--platform linux` or `--platform win`
- Output artifacts land in `release/` (or `release-mock/` with `--mock-updates`)

# Community release distribution

[Download community-v0.1.2](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.2). All seven archives plus `SHA256SUMS` and `release-manifest.json` are public: nine assets in total. Anonymous GHCR registry manifest access and its digest were verified. The full Docker pull used the operator's existing Docker configuration; it is not claimed as an anonymous full-image pull.

```sh
docker pull --platform linux/amd64 ghcr.io/crosstabs/likerts@sha256:40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c
```

Community releases use tags such as `community-v0.1.2`. The tag identifies a complete source snapshot and is independent of the embedded component versions: Web and React Native currently identify as `0.0.3`, MCP as `0.1.0`, and the Rust CLI as `0.1.2`. The current snapshot is source `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42`; backend runtime `0.1.2` includes export-revocation journaling and bounded archive storage retries. Use this runtime for new installations; updating a CLI or SDK alone does not update an operator's backend. Earlier community tags/assets and historical archives under `releases/` remain unchanged.

Publication was anonymously verified on 2026-09-13 at 05:15:31 UTC: the release is public, all nine asset digests match the reviewed draft, and anonymous GHCR manifest bytes match the digest above. Fresh downloaded CLI/runtime checks passed scoped collection, identical retry, one-response readback and revocation. The provider still reports `immutable: false`; protected tags and preserved assets are not a claim of provider-enforced release locking. [Release workflow](https://github.com/crosstabs/likerts/actions/runs/34739207955), [launch evidence](../PUBLIC-LAUNCH.md).

The release workflow builds candidates first. Only after every candidate succeeds does its publisher push the tested runtime image to GHCR and create a **draft** GitHub release. It does not promote that draft to a public release, publish npm packages, or deploy the hosted service. The GHCR push itself happens before the draft is reviewed; GitHub package visibility is managed separately.

## Available assets after publication

| Asset | Use |
| --- | --- |
| `community-v0.1.2-cli-linux-x64.tar.gz` | Native Linux amd64 CLI; glibc 2.35 or newer. |
| `community-v0.1.2-cli-darwin-arm64.tar.gz` | Native Apple Silicon macOS CLI. |
| `community-v0.1.2-cli-windows-x64.tar.gz` | Native Windows amd64 CLI, including `likerts.exe`. |
| `community-v0.1.2-web.tgz` | Installable Web npm package with compiled JavaScript and declarations. |
| `community-v0.1.2-react-native.tgz` | Installable React Native npm package with Metro source and declarations. |
| `community-v0.1.2-mcp.tgz` | Installable MCP npm package with its bundled operation registry and API schemas. |
| `community-v0.1.2-runtime-linux-x64.tar.gz` | Compressed `docker save` archive of the tested Linux amd64 runtime. |
| `SHA256SUMS`, `release-manifest.json` | Asset checksums, source SHA, embedded package versions, and verification boundaries. |
| GitHub source ZIP and tar.gz | GitHub-generated source snapshot for the tag, including iOS, Android, and Flutter SDK sources. |

These filenames describe what the pipeline produces; a draft or an unrun workflow is not a public download. Find published versions on the [GitHub releases page](https://github.com/crosstabs/likerts/releases).

## Install a published candidate

Download the appropriate assets and `SHA256SUMS` from the same release. On Linux, use `sha256sum --check --ignore-missing SHA256SUMS`; on macOS use `shasum -a 256 --check --ignore-missing SHA256SUMS`. Windows users can compare `Get-FileHash -Algorithm SHA256` output with the matching entry. Checksums establish byte integrity, not a separate code-signing identity.

Extract the CLI archive and put `likerts` or `likerts.exe` on `PATH`, then run `likerts --version` and `likerts capabilities`. The binaries are unsigned and not notarized. Follow [the management guide](../tools/README.md) to supply an API origin and scoped credentials.

From a compatible application directory, install the downloaded package using `npm install /absolute/path/to/community-v0.1.2-web.tgz` or the React Native tarball. The package names remain `@likerts/web` and `@likerts/react-native`. Install the MCP tarball in a dedicated Node project and use the package's stdio entry point as documented in [the MCP guide](../tools/README.md). No package-registry login is needed to install a local tarball.

Use the digest recorded in release notes for the runtime image, or load the downloaded image with `gzip -dc community-v0.1.2-runtime-linux-x64.tar.gz | docker load`. The backend runtime is `0.1.2` and contains all five binaries: `likerts-server`, `likerts-migrate`, `likerts-webhook-worker`, `likerts-export-cleanup` and `likerts-erasure-archive`. Including maintenance binaries does not configure or start their schedules. Production operation still requires PostgreSQL, role provisioning, secrets, admission controls, and the other settings in [the repository setup guide](../README.md). Loading an image alone does not provision a deployment.

## Maintainer flow

1. Merge the intended source into `main` and wait for **Verify foundations** to succeed on that exact commit. Both `interfaces-and-database` and `container` must succeed on the main push run.
2. Create an immutable `community-vX.Y.Z` tag at that commit. Configure repository tag protection to prevent moving released tags. Existing component version fields can stay unchanged when this is only a distribution snapshot; bump an individual package version before separately publishing a changed package to a registry.
3. Run **Stage community release** from `main`, entering the existing tag and its complete 40-character commit SHA. The workflow validates the tag, main ancestry, and required CI before building.
4. Inspect all build jobs, the draft release, manifest, and image digest. Test installation on the platforms you intend to support before manually publishing the draft. macOS and Windows artifacts must execute on their native CI runners; a successful local macOS run says nothing about a pending Windows job.

Only the publisher job receives `contents: write` and `packages: write`; candidate builds have read-only repository access. Artifact transfer actions are pinned to verified commit SHAs. The publisher downloads and promotes the exact tested image rather than rebuilding it. Release reruns refuse to replace an existing GitHub release or either GHCR tag. If publication fails after a registry push, inspect the partial result and recover it manually; a rerun will not overwrite it. Network and authorization failures during the registry preflight stop publication rather than being treated as an absent tag.

All generated files go to ignored `.tools/community-stage` or a temporary output directory. The old frozen release scripts and archives are not rewritten by this pipeline.

## Install from npm

The first public npm packages are available under the `@likerts` organization:

| Package | Version | Install |
| --- | --- | --- |
| [Web](https://www.npmjs.com/package/@likerts/web) | `0.0.3` | `npm install @likerts/web@0.0.3` |
| [React Native](https://www.npmjs.com/package/@likerts/react-native) | `0.0.3` | `npm install @likerts/react-native@0.0.3` |
| [MCP](https://www.npmjs.com/package/@likerts/mcp) | `0.1.0` | `npm install --global @likerts/mcp@0.1.0` |

Use Node.js 22 or newer. The React Native package requires React `^19.2.3` and React Native `>=0.85 <0.88`. iOS is available at Swift Git tag `0.1.0`; Flutter is published as [likerts `0.0.3`](https://pub.dev/packages/likerts/versions/0.0.3). Android is published on Maven Central as `com.likerts:likerts-android:0.0.3`, with source builds also supported. See the [installation matrix](../sdks/INSTALLATION.md).

Fresh registry installations passed Web public/offline export and schema-capability checks, React Native Metro/JavaScript/TypeScript entry-point checks, and MCP stdio discovery of all 33 tools plus an authenticated `usage_get` call against a local test API. React Native rendering is verified separately by the native component tests; package installation alone does not exercise a device.

### Publish a subsequent version

Start from a clean, tested checkout. Bump the changed package's version and lockfile before publishing; npm versions cannot be replaced. Authenticate with an account that has publishing rights to the `@likerts` scope, install its locked dependencies, and run `npm publish` in that package directory. Complete npm's security challenge in the browser.

Each package rebuilds before packing and fixes its publishing destination to `https://registry.npmjs.org/` with public access. Verify registry versions and fresh consumer installations after publication. Historical community-release tarballs and tags remain immutable. Never commit login tokens.

## Local verification

```sh
node --test scripts/package-community-release.test.mjs
source scripts/dev-env.sh
cargo build --locked --release --manifest-path tools/cli/Cargo.toml
node scripts/package-community-release.mjs --kind cli --tag community-v0.1.2 --target darwin-arm64 --binary tools/cli/target/release/likerts
npm ci --prefix sdks/web
npm run build --prefix sdks/web
node scripts/package-community-release.mjs --kind npm --tag community-v0.1.2 --package sdks/web
```

Use the target matching your native operating system and CPU; the script refuses cross-target claims. Pass `--output /absolute/temporary/directory` to select a fresh location. Existing asset paths are never overwritten. The packager verifies CLI version and exact capability parity before and after extraction, checks archive paths and MIT license bytes, scans text for recognizable credential patterns, and installs npm tarballs in fresh consumers. MCP additionally performs installed stdio tool discovery. React Native packaging checks its installed entry points; renderer behavior is checked separately in the native component suite. Credential-pattern scanning is a bounded check, not proof that arbitrary secrets cannot exist.

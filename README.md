# Likerts

Your people. Your wavelength. Likerts is a social mind-reading and quiz game with live browser rooms, a local quiz library and an iPhone app with native Messages play.

[Play Live](https://likerts.com/play) · [Create or practice a quiz](https://likerts.com/play/quizzes) · [Support](https://likerts.com/game/support)

## App source

- `game/WebSource/live-game`: authoritative Node server, browser game, local quiz authoring/practice and tests.
- `game/NativeSource`: iPhone and Messages source, Xcode project and native tests.
- `game/SharedFixtures`: shared quiz contracts and samples used by both clients.
- `control-plane`: game-only marketing website and the `/play` entry redirect.

The source layout retains the relative paths used by the verified shared fixtures and original-art provenance tests. See [SOURCE-PROVENANCE.json](SOURCE-PROVENANCE.json) for the exact imported source identities. No build products, dependencies, databases, credentials or private QA evidence are included.

## Run the browser game locally

Use Node 22.23.4 and npm:

```sh
cd game/WebSource/live-game
npm ci
npm test
npm start
```

The [game README](game/WebSource/live-game/README.md) documents server configuration, development modes and PostgreSQL tests. PostgreSQL integration cases require an explicit disposable test database; never point tests at a production database. Production starts with `node deployment/render-entry.mjs` and requires its dedicated database role and validated configuration.

## iPhone development

Open `game/NativeSource/Likerts.xcodeproj`. The project includes the app, native Messages extension and tests. The iPhone and App Store release is separate from the live browser release. Distribution signing and device qualification are not implied by publishing source. `project.yml` is the XcodeGen source.

## Development and deployment

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [website README](control-plane/README.md). CI retains the required `interfaces-and-database` and `container` checks with game-specific validation.

The obsolete embedded-feedback product is removed from the active source and public website. Its previous implementation remains recoverable in Git history and existing release tags. Historical source and data are not permanently erased by this change; no old data service is reused for game rooms.

[MIT License](LICENSE) · [Code of Conduct](CODE_OF_CONDUCT.md)

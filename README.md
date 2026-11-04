# PSL Translator

Live **Pakistan Sign Language → English and Urdu** text in the browser. It
runs entirely on the device: video is never uploaded, and nothing needs to be
installed. It is a static site on GitHub Pages and works offline after the first use.

> **Status: early test build (milestone 2 of 6).** Camera, hand tracking,
> diagnostics and offline support are in place. **Sign recognition is not built
> yet.** See [PROGRESS.md](PROGRESS.md) for exactly what works, what has been
> measured, and what has not been tested on real devices.

The app can make mistakes. It does not replace a qualified interpreter for
medical, legal or other high-stakes situations.

## Try it

`https://ibapss.github.io/signLang/` (after deployment from `main`).
To help test, follow [docs/DEVICE_CHECKLIST.md](docs/DEVICE_CHECKLIST.md).

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173/signLang/
npm test           # unit tests
npm run build && npm run e2e -- --project=chromium-desktop
```

More commands and conventions: [CLAUDE.md](CLAUDE.md). Data sources:
[docs/DATASETS.md](docs/DATASETS.md). Attributions: [THIRD_PARTY.md](THIRD_PARTY.md).

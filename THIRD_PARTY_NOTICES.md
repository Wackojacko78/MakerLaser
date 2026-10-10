# Third-party notices

MakerLaser is GPL-3.0-or-later (see `LICENSE`). It links the open-source libraries below, each
under its own licence; consult the crate or package page for the exact terms.

| Component | Licence (as published by the project) |
|---|---|
| Tauri, tauri-plugin-dialog | MIT or Apache-2.0 |
| React, React DOM, Zustand, Konva, react-konva, use-image, Vite, Vitest | MIT |
| `clipper2` crate and the Clipper2 C++ library it wraps | MIT/Apache-2.0 (crate); Boost Software License 1.0 (Clipper2) |
| `serialport` | MPL-2.0 |
| `zip`, `image`, `roxmltree`, `serde`, `serde_json`, `thiserror`, `uuid`, `base64`, `log`, `env_logger` | MIT and/or Apache-2.0 |

## Bundled fonts

MakerLaser ships these open-licence fonts (packaged by Fontsource, <https://fontsource.org>) so text
looks the same on every computer. They are separate data files, not linked code. Each package declares
its own licence, mostly the SIL Open Font License 1.1 (some may be Apache 2.0); the full text is in
`node_modules/@fontsource/<package>/LICENSE`. Run `node scripts/font-licenses.mjs` to list the licence
each package declares, and check it before a public release.

| Family | Package |
|---|---|
| Roboto | `@fontsource/roboto` |
| Open Sans | `@fontsource/open-sans` |
| Lato | `@fontsource/lato` |
| Montserrat | `@fontsource/montserrat` |
| Poppins | `@fontsource/poppins` |
| Nunito | `@fontsource/nunito` |
| Raleway | `@fontsource/raleway` |
| Inter | `@fontsource/inter` |
| Oswald | `@fontsource/oswald` |
| Merriweather | `@fontsource/merriweather` |
| Playfair Display | `@fontsource/playfair-display` |
| Lora | `@fontsource/lora` |
| PT Serif | `@fontsource/pt-serif` |
| Cinzel | `@fontsource/cinzel` |
| Roboto Slab | `@fontsource/roboto-slab` |
| Bitter | `@fontsource/bitter` |
| Bebas Neue | `@fontsource/bebas-neue` |
| Anton | `@fontsource/anton` |
| Abril Fatface | `@fontsource/abril-fatface` |
| Archivo Black | `@fontsource/archivo-black` |
| Righteous | `@fontsource/righteous` |
| Bangers | `@fontsource/bangers` |
| Black Ops One | `@fontsource/black-ops-one` |
| Orbitron | `@fontsource/orbitron` |
| Press Start 2P | `@fontsource/press-start-2p` |
| Pacifico | `@fontsource/pacifico` |
| Dancing Script | `@fontsource/dancing-script` |
| Lobster | `@fontsource/lobster` |
| Great Vibes | `@fontsource/great-vibes` |
| Caveat | `@fontsource/caveat` |
| Permanent Marker | `@fontsource/permanent-marker` |
| Satisfy | `@fontsource/satisfy` |
| Source Code Pro | `@fontsource/source-code-pro` |
| JetBrains Mono | `@fontsource/jetbrains-mono` |
| Roboto Mono | `@fontsource/roboto-mono` |

## Design references (no source copied)

* **LaserGRBL** (<https://github.com/arkypita/LaserGRBL>, GPLv3): studied for behaviour such as
  alarm/error decoding and feature scope. No LaserGRBL source, assets or data are included.
* **GRBL** (<https://github.com/gnea/grbl>, GPLv3): the public protocol documentation and
  error/alarm code lists informed `packages/machine/src/grbl_codes.rs`. No firmware source is
  included.

If code is ever ported from another project, record the upstream repository, commit, files,
licence and the changes made here *before* merging.

## A note on the licence choice

Because no GPL code from other projects is incorporated, the copyright holder could choose a
different licence before the first public release (for example a permissive one if a
commercial product is planned). That is a decision for the project owner. If this work is
done within an organisation that has an open-source policy, check that policy before
distributing or contributing.

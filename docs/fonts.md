# Fonts

MakerLaser draws text with fonts. There are two kinds in the font list.

## Fonts that come with MakerLaser

35 families are built in, so text looks the same on every computer (Windows, Linux or Mac) and
works offline. They are grouped in the list by kind:

| Kind | Fonts |
|---|---|
| Sans-serif | Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, Inter, Oswald |
| Serif | Merriweather, Playfair Display, Lora, PT Serif, Cinzel |
| Slab serif | Roboto Slab, Bitter |
| Display and headline | Bebas Neue, Anton, Abril Fatface, Archivo Black, Righteous, Bangers, Black Ops One (stencil), Orbitron, Press Start 2P (pixel) |
| Script and handwriting | Pacifico, Dancing Script, Lobster, Great Vibes, Caveat, Permanent Marker, Satisfy |
| Monospace | Source Code Pro, JetBrains Mono, Roboto Mono |

The font name is saved with the text. A project opened on another computer keeps the same look
when the font is one of these. If it was made with an installed font the other computer does not
have, the text stays editable, the font box shows the name with "(not installed)", and it is drawn
in a plain font until you pick another.

## Fonts installed on your computer

The list also offers the common fonts that are installed on this computer (Arial, Segoe UI,
Calibri, Trebuchet MS, Georgia and more), under "Installed on this computer". A font that is
installed but not on MakerLaser's list of names to look for does not appear.

## Using the list

Pick the text, open its editor (double-click, or the boxes in the Properties panel) and choose from
the **Font** list. Each name is shown in its own font where the window allows it. With the list
focused, typing the first letters of a name jumps to it.

## Good to know

- **Bold and italic.** Fonts with a bold or italic face use it. Fonts without one (most display
  and script fonts have one weight) are thickened or slanted by the browser. This is fine for
  engraving but is not what the designer drew.
- **Macrons and accents.** The everyday fonts (all the sans-serif, serif, slab and monospace ones)
  include the Latin Extended set, so Māori macrons (ā ē ī ō ū), and Polish, Czech or Turkish
  letters, are drawn in the font. The display and script fonts have only the basic Latin and
  Western European set: a letter they lack is drawn in a plain font instead.
- **Outline mode traces the edges of each letter.** Thin script fonts and small text come out as
  two close lines. For engraving, Engrave (fill) mode usually looks best. A single-line font mode,
  where each letter is one stroke, is a separate feature.
- **The first time a font is used** the window loads it, which takes a moment. Text changes made
  while it loads are held and applied together, so nothing is lost.

## Adding another font

1. Find it on <https://fontsource.org> and note its package name, for example `@fontsource/oswald`.
2. Add a line to `BUNDLED_FONTS` in `apps/desktop-ui/src/lib/bundledFonts.ts`.
3. Run `npm install -w desktop-ui @fontsource/<package>` from the repo root.
4. Add its import lines to `apps/desktop-ui/src/fonts/bundled.ts`.
5. Run `npm test` in `apps/desktop-ui`. The tests check that every listed font has its package
   installed, every CSS file exists and every import matches the list.
6. Run `node scripts/font-licenses.mjs` and add the licence to `THIRD_PARTY_NOTICES.md`.

## Licences

The fonts are open-licence fonts from Google Fonts, packaged by Fontsource, and are mostly under
the SIL Open Font License 1.1 (some may be Apache 2.0). They may be bundled and redistributed with
software, including GPL software, as separate data files. The licence text for each is in its package folder under
`node_modules/@fontsource/<name>/LICENSE`. Run `node scripts/font-licenses.mjs` to list the licence
each installed package declares; check the output before a public release.

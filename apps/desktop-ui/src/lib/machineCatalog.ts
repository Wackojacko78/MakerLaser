// A starter catalogue of common diode laser machines for the Machine window's preset list.
// Pure data plus tiny helpers (no React or Tauri imports), unit-tested in plain Node
// (tests/machineCatalog.test.ts). Every `machine` is a normal machine profile, so it goes
// through the same validation as an imported machine file.
//
// HOW TO READ AN ENTRY
//  - Bed sizes come from the maker's own page where `official` is true, otherwise from a
//    comparison or review page (`listing`). Where sources disagreed, the SMALLER size is used so
//    the "outside the bed" check never lets a job run off the machine. It may reject a job that
//    would fit: check against your own machine.
//  - max_feed_rate is the speed ceiling. Where no top speed was published, 6000 mm/min is used and
//    the entry says so. The machine's own GRBL $110/$111 is what actually limits it.
//  - `origin` is bottom_left (the usual GRBL laser front-left) for every machine. NOT verified per
//    machine. Use the jog test in docs/catalog.md before a real job.
//  - Max S is 1000 ($30=1000) everywhere. Only Ortur publishes it; check yours with `$$`.
//  - `grbl: 'listed'` means a source for that model says it works with LightBurn/LaserGRBL (both
//    speak GRBL). `'assumed'` means it is expected from the brand, with no source for that model.
//
// To add or fix a machine, edit MACHINE_CATALOG: one `mk(...)` per machine, with a source URL.

import type { MachineEntry } from '@/lib/configFormat';

export const CATALOG_PREFIX = 'catalog:';

export type Grbl = 'listed' | 'assumed';
/** 'published': a source gave this top speed. 'default': none was found, so a low default is used. */
export type FeedBasis = 'published' | 'default';

export interface CatalogEntry {
  machine: MachineEntry;
  brand: string;
  laserW: number;
  /** True when the bed size is from the maker's own page, manual or spec sheet. */
  official: boolean;
  grbl: Grbl;
  feedBasis: FeedBasis;
  /** Where the numbers came from. */
  source: string;
  /** Anything to know before using this profile. */
  notes: string;
}

interface Spec {
  brand: string;
  model: string;
  laserW: number;
  w: number;
  h: number;
  feed: number;
  air?: boolean;
  homing?: boolean;
  official?: boolean;
  grbl?: Grbl;
  /** Set when no top speed was published and `feed` is only a conservative default. */
  feedDefault?: boolean;
  source: string;
  notes?: string;
  s?: number;
}

function mk(s: Spec): CatalogEntry {
  return {
    brand: s.brand,
    laserW: s.laserW,
    official: s.official ?? false,
    grbl: s.grbl ?? 'listed',
    feedBasis: s.feedDefault ? 'default' : 'published',
    source: s.source,
    notes: s.notes ?? '',
    machine: {
      name: `${s.brand} ${s.model}`,
      controller: 'grbl1_1',
      bed_width_mm: s.w,
      bed_height_mm: s.h,
      origin: 'bottom_left',
      max_feed_rate_mm_min: s.feed,
      max_spindle_value: s.s ?? 1000,
      homing_supported: s.homing ?? false,
      air_assist_supported: s.air ?? false,
      baud_rate: 115200,
    },
  };
}

const LC = 'https://laserscompare.com/laser/';

export const MACHINE_CATALOG: readonly CatalogEntry[] = [
  mk({ brand: 'Sculpfun', model: 'S9 5.5W', laserW: 5.5, w: 410, h: 415, feed: 6000, source: `${LC}sculpfun-s9`,
    notes: "Sculpfun's own spec lists 410 x 420; LasersCompare lists 410 x 415, so the smaller is used. The 10 W model is the S9 Pro, a different machine." }),
  mk({ brand: 'Sculpfun', model: 'S30 Pro Max 20W', laserW: 20, w: 370, h: 360, feed: 6000, air: true, official: true, source: 'https://www.sculpfun.com/products/sculpfun-s30-pro-max-laser-engraver-machine',
    notes: 'Standard 370 x 360 bed (expandable with extension kits: change the bed size if you have fitted one). 6000 mm/min is the maker\'s figure and the firmware limit users report; a LasersCompare listing says 18000.' }),
  mk({ brand: 'Atomstack', model: 'A5 Pro 5W', laserW: 5, w: 410, h: 400, feed: 6000, source: `${LC}atomstack-a5-pro` }),
  mk({ brand: 'Atomstack', model: 'A10 Pro V2 10W', laserW: 10, w: 410, h: 380, feed: 10000, official: true, source: 'https://atomstack.com/blogs/news/3-atomstack-laser-engravers-under-500-in-2026-a10-pro-v2-a20-pro-v2-or-a24-pro',
    notes: 'Bed from Atomstack. 10000 mm/min is the figure a review gives for the A10 Pro; Atomstack states 400 mm/s motion speed. Air assist is included only in some bundles: tick it in Machine settings if yours has it.' }),
  mk({ brand: 'Atomstack', model: 'A20 Pro V2 20W', laserW: 20, w: 400, h: 365, feed: 10000, air: true, official: true, source: 'https://atomstack.com/blogs/news/3-atomstack-laser-engravers-under-500-in-2026-a10-pro-v2-a20-pro-v2-or-a24-pro',
    notes: 'Atomstack lists 400 x 365 for the V2; a review of the original A20 Pro lists 400 x 400. The smaller is used.' }),
  mk({ brand: 'Atomstack', model: 'X20 Pro 20W', laserW: 20, w: 400, h: 400, feed: 6000, feedDefault: true, air: true, source: 'https://laserbeamforge.com/atomstack-x20-pro-review/',
    notes: 'No top speed found for this model, so 6000 mm/min is used. Bed from a review: Bonny Creations also lists an extended 1000 x 800 version of this model, so check yours.' }),
  mk({ brand: 'Creality', model: 'Falcon2 22W', laserW: 22, w: 400, h: 415, feed: 25000, air: true, official: true, source: 'https://www.creality.com/products/creality-falcon2-22w',
    notes: 'Manual focus. Rated 25000 mm/min by Creality.' }),
  mk({ brand: 'Creality', model: 'Falcon2 Pro 22W', laserW: 22, w: 400, h: 415, feed: 36000, air: true, source: 'https://laserscompare.com/compare/algolaser-alpha-mk2-20w-vs-creality-falcon2-pro',
    notes: 'Enclosed. 36000 mm/min is the rated figure from a comparison listing.' }),
  mk({ brand: 'Creality', model: 'Falcon A1C Basic 10W', laserW: 10, w: 150, h: 150, feed: 15000, grbl: 'assumed', source: `${LC}creality-falcon-a1c-basic-10w`,
    notes: 'Small 150 x 150 bed, enclosed, no air assist. Listed as compatible with LightBurn and LaserGRBL, but no source states its firmware.' }),
  mk({ brand: 'Ortur', model: 'Laser Master 3 10W', laserW: 10, w: 400, h: 400, feed: 20000, official: true, source: 'https://www.orturlaser.com/pages/ortur-laser-master-3-support',
    notes: 'Ortur publishes 400 x 400, S0-S1000, 115200 baud and up to 20000 mm/min. Air assist is a separate add-on.' }),
  mk({ brand: 'Ortur', model: 'Laser Master 3 20W', laserW: 20, w: 400, h: 380, feed: 20000, official: true, source: 'https://www.orturlaser.com/pages/ortur-laser-master-3-support',
    notes: 'The 20 W module has a smaller 400 x 380 engraving area than the 10 W.' }),
  mk({ brand: 'Ortur', model: 'Laser Master 3 40W', laserW: 40, w: 400, h: 380, feed: 20000, official: true, source: 'https://www.orturlaser.com/pages/ortur-laser-master-3-support',
    notes: 'The 40 W module has a smaller 400 x 380 engraving area than the 10 W.' }),
  mk({ brand: 'Two Trees', model: 'TTS-55 5.5W', laserW: 5.5, w: 300, h: 300, feed: 10000, official: true, source: 'https://twotrees3d.com/pages/compare-tts-55-tts-25-tt-2-5-5-5',
    notes: 'The TTS-55 Pro that MakerLaser started with is already in the built-in list. Speed from a LasersCompare listing.' }),
  mk({ brand: 'Two Trees', model: 'TS2 Pro 10W', laserW: 10, w: 450, h: 450, feed: 15000, grbl: 'assumed', source: `${LC}two-trees-tts-55`,
    notes: 'Only a one-line listing was found (450 x 450, 15000 mm/min). Check everything.' }),
  mk({ brand: 'AlgoLaser', model: 'Alpha MK2 20W', laserW: 20, w: 400, h: 410, feed: 20000, air: true, official: true, source: 'https://algolaser.com/blogs/news/revolutionizing-laser-engraving-algolaser-alpha-mk2',
    notes: 'AlgoLaser publishes 20000 mm/min engraving speed and a 400 x 410 area (400 x 850 with the extension kit). One review calls it 22 W; AlgoLaser says 20 W.' }),
  mk({ brand: 'Longer', model: 'Ray5 10W', laserW: 10, w: 400, h: 400, feed: 6000, source: 'https://www.longer.net/blogs/software/review-about-longer-ray5-10w-10-12w-power-everything',
    notes: 'Longer rates 10000 mm/min, but a user reading $110/$111 on a Ray5 10W found 6000, which is used here. The 5 W and 10 W versions have no limit switches.' }),
  mk({ brand: 'ACMER', model: 'P1 10W', laserW: 10, w: 400, h: 410, feed: 6000, feedDefault: true, homing: true, official: true, source: 'https://acmerlaser.com/blogs/video/acmer-p1-10w-laser-engraver-assembly-and-test-easily-cuts-19-mm-spruce-wood',
    notes: 'Has limit switches and homes at the rear left. A reviewer found Y moved backwards in LightBurn until importing ACMER\'s settings file, which changes GRBL $3 and $23: check the jog test. No top speed found, so 6000 mm/min is used.' }),
  mk({ brand: 'ACMER', model: 'P1 S Pro 10W', laserW: 10, w: 380, h: 370, feed: 10000, homing: true, official: true, source: 'https://manuals.plus/asin/B0FH9QCV6L',
    notes: 'Limit switches on both axes. Speed and spot size from the manual.' }),
  mk({ brand: 'Comgrow', model: 'COMGO Z1 10W', laserW: 10, w: 400, h: 400, feed: 5000, homing: true, source: 'https://hobbylasercutters.com/comgrow-comgo-z1/',
    notes: 'Has home switches. A reviewer measured a 5000 mm/min top speed. No air assist as standard.' }),
];

/** The catalogue entry whose machine has this name, or undefined. */
export const findCatalogEntry = (name: string): CatalogEntry | undefined => MACHINE_CATALOG.find((c) => c.machine.name === name);

/** The message to show after choosing a catalogue machine. Always asks for the two checks that matter. */
export function catalogNote(c: CatalogEntry): string {
  const bits = [
    `Bed ${c.machine.bed_width_mm} x ${c.machine.bed_height_mm} mm (${c.official ? "from the maker" : "from a listing"}).`,
    c.grbl === 'assumed' ? 'GRBL is assumed, not confirmed for this model.' : '',
    c.feedBasis === 'default' ? 'No top speed was published, so a low default is used.' : '',
    c.notes,
    'Check the bed size and origin on your own machine with the jog test before a real job.',
  ];
  return bits.filter((b) => b !== '').join(' ');
}

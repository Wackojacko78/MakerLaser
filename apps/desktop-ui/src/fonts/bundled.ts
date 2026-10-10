// Imports the CSS (and so the font files) of every bundled font. Vite copies the font files into the
// app, so they are served from the app itself and need no internet connection, and the browser only
// loads a face when text first uses it. What to import is listed in lib/bundledFonts.ts, and
// tests/bundledFontsSource.test.ts checks the two agree.
//
// Only the Latin and Latin Extended character sets are imported. Latin Extended carries macrons
// (a e i o u with a bar), Polish, Czech and Turkish letters; the display and script fonts have the
// basic Latin set only.

// Sans-serif
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-400-italic.css';
import '@fontsource/roboto/latin-ext-400.css';
import '@fontsource/roboto/latin-ext-400-italic.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-700-italic.css';
import '@fontsource/roboto/latin-ext-700.css';
import '@fontsource/roboto/latin-ext-700-italic.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-400-italic.css';
import '@fontsource/open-sans/latin-ext-400.css';
import '@fontsource/open-sans/latin-ext-400-italic.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/open-sans/latin-700-italic.css';
import '@fontsource/open-sans/latin-ext-700.css';
import '@fontsource/open-sans/latin-ext-700-italic.css';
import '@fontsource/lato/latin-400.css';
import '@fontsource/lato/latin-400-italic.css';
import '@fontsource/lato/latin-ext-400.css';
import '@fontsource/lato/latin-ext-400-italic.css';
import '@fontsource/lato/latin-700.css';
import '@fontsource/lato/latin-700-italic.css';
import '@fontsource/lato/latin-ext-700.css';
import '@fontsource/lato/latin-ext-700-italic.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-ext-400.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/montserrat/latin-ext-700.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-ext-400.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-ext-700.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-ext-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-ext-700.css';
import '@fontsource/raleway/latin-400.css';
import '@fontsource/raleway/latin-ext-400.css';
import '@fontsource/raleway/latin-700.css';
import '@fontsource/raleway/latin-ext-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-ext-400.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/oswald/latin-ext-700.css';

// Serif
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-400-italic.css';
import '@fontsource/merriweather/latin-ext-400.css';
import '@fontsource/merriweather/latin-ext-400-italic.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-700-italic.css';
import '@fontsource/merriweather/latin-ext-700.css';
import '@fontsource/merriweather/latin-ext-700-italic.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-ext-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-ext-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-ext-400.css';
import '@fontsource/lora/latin-ext-400-italic.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/lora/latin-700-italic.css';
import '@fontsource/lora/latin-ext-700.css';
import '@fontsource/lora/latin-ext-700-italic.css';
import '@fontsource/pt-serif/latin-400.css';
import '@fontsource/pt-serif/latin-ext-400.css';
import '@fontsource/pt-serif/latin-700.css';
import '@fontsource/pt-serif/latin-ext-700.css';
import '@fontsource/cinzel/latin-400.css';
import '@fontsource/cinzel/latin-700.css';

// Slab serif
import '@fontsource/roboto-slab/latin-400.css';
import '@fontsource/roboto-slab/latin-ext-400.css';
import '@fontsource/roboto-slab/latin-700.css';
import '@fontsource/roboto-slab/latin-ext-700.css';
import '@fontsource/bitter/latin-400.css';
import '@fontsource/bitter/latin-ext-400.css';
import '@fontsource/bitter/latin-700.css';
import '@fontsource/bitter/latin-ext-700.css';

// Display and headline
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/righteous/latin-400.css';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/black-ops-one/latin-400.css';
import '@fontsource/orbitron/latin-400.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/press-start-2p/latin-400.css';

// Script and handwriting
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/dancing-script/latin-400.css';
import '@fontsource/dancing-script/latin-700.css';
import '@fontsource/lobster/latin-400.css';
import '@fontsource/great-vibes/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';
import '@fontsource/satisfy/latin-400.css';

// Monospace
import '@fontsource/source-code-pro/latin-400.css';
import '@fontsource/source-code-pro/latin-ext-400.css';
import '@fontsource/source-code-pro/latin-700.css';
import '@fontsource/source-code-pro/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-ext-700.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-ext-400.css';
import '@fontsource/roboto-mono/latin-700.css';
import '@fontsource/roboto-mono/latin-ext-700.css';

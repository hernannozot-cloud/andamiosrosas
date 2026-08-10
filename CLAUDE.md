# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single static marketing/quoting site for "Andamios Rosas", a scaffolding (andamios) rental
business in Toluca, Mexico. No framework, no build step, no package.json — plain HTML/CSS/JS
served as static files.

```
sitio-web/
  index.html      # entire site: header/nav, hero, catálogo, cómo-funciona, cotizar (quote form), contacto, feedback modal
  style.css       # all styling, CSS custom properties in :root (--pink, --dark, etc.)
  logic.js        # pure, DOM-free helpers shared by script.js and the tests (see below)
  script.js       # all DOM/event wiring (see below)
  assets/         # logo, favicon, icono_negro.png, assets/productos/*.jpg (product photos)
  tests/          # browser-run test suite for logic.js (see Testing below)
LOGOS/            # source brand assets (multiple logo variants, profile pics) — not referenced by the site directly
sitio-web.zip     # zipped copy of sitio-web/ for handoff/deployment (rebuilt manually, see below)
```

This is a git repository (initialized locally, no remote configured) — use `git log`/`git diff` as
usual. Node.js/npm and the GitHub CLI (`gh`) are **not installed** on this machine; don't assume
either is available.

## Running locally

No build tooling. Serve `sitio-web/` with any static file server, e.g.:

```bash
python -m http.server 8790
```

Then open `http://localhost:8790/`. There is no linter configured. A Claude Code browser-preview
config already exists at `.claude/launch.json` (serves `sitio-web/` on port 8800 via the `py.exe`
launcher) — use `preview_start` with name `andamios-site` instead of hand-rolling a server.

## Testing

Node/npm aren't installed, so there's no `npm test`. Tests live in `sitio-web/tests/` as
**standalone HTML files** that load `../logic.js` directly (no bundler, no framework — a ~20-line
inline assert helper) and render pass/fail results into the page plus the document `<title>`
(`PASS - ...` / `FAIL - ...`).

To run them: serve `sitio-web/` (see above) and open `tests/logic.test.html` in a browser — or use
the Claude Code Browser tool (`preview_start` name `andamios-site`, then `navigate` to
`tests/logic.test.html`, then `get_page_text` to read the pass/fail list and final tally).

Only the pure functions in `logic.js` are unit-tested this way. DOM/event wiring in `script.js`
(modal open/close, form submit building the `wa.me` URL, etc.) isn't covered by the HTML test
suite — verify those manually in the browser (e.g. click through the flow, or stub
`window.open` from devtools/`javascript_tool` to capture the URL it would have opened without
actually navigating away).

## Cache busting

`index.html` loads `style.css?v=N` and `script.js?v=N`. **Bump the `?v=` query param any time you
edit `style.css` or `script.js`**, otherwise browsers may serve stale cached copies.

## Packaging for deployment

`sitio-web.zip` is a manually-produced snapshot of the `sitio-web/` folder (index.html, style.css,
script.js, assets). Rebuild it after making changes if the user needs an updated deployable zip:

```bash
powershell -NoProfile -Command "Compress-Archive -Path index.html,style.css,script.js,assets -DestinationPath '../sitio-web.zip' -Force"
```
(run from inside `sitio-web/`).

## Architecture of logic.js + script.js

Logic is split across two files, both loaded as plain `<script>` tags (no modules/bundler) — order
matters: `logic.js` must load before `script.js`.

- **`logic.js`**: pure, DOM-free functions and config constants, attached to a single global
  namespace `window.AR`: `PRECIO_POR_DIA` (price per scaffold per day, MXN), `TOLUCA_LAT`/
  `TOLUCA_LON`/`RADIO_ENTREGA_GRATIS_KM` (free-delivery radius), `distanciaKm()` (haversine),
  `formatoMXN()`, and the feedback helpers `validateFeedback()`/`buildFeedbackMessage()`. This file
  exists specifically so `tests/*.html` can load it standalone without a full DOM. If you add new
  calculation/formatting logic, put it here (not in `script.js`) so it stays testable.
- **`script.js`**: all DOM/event wiring, destructures what it needs off `AR` at the top. Key pieces:
  - **Quote flow**: the "Cotizar" section has a quantity stepper per scaffold type (`.qty-input`,
    keyed by `data-tipo`), a days input, and an address field. `calcularTotal()` recomputes the
    total live (`PRECIO_POR_DIA × total scaffolds × días`) and decides free-delivery messaging via
    `AR.distanciaKm()`.
  - **Address autocomplete**: debounced (450ms) calls to the public OpenStreetMap Nominatim API
    (`nominatim.openstreetmap.org/search`, no API key) biased toward the Toluca/CDMX viewbox,
    populates a suggestion list; selecting a suggestion sets `zonaCoords` used by the
    delivery-radius check.
  - **Quote submit**: builds a plain-text summary and opens
    `https://wa.me/<WHATSAPP_NUMBER>?text=<encoded message>`.
  - **Feedback modal** (`#feedbackFloat` button → `#feedbackOverlay`/`#feedbackForm`): star rating
    (1–5, `.star-btn[data-value]`) plus an optional comment. Requires a rating or a comment
    (`AR.validateFeedback`); on submit builds a message with `AR.buildFeedbackMessage` and opens it
    via the same `wa.me` pattern as the quote form. Closes on the ✕ button, clicking the overlay
    backdrop, Escape, or successful submit.
  - Catalog "Solicitar cotización" buttons (`.card-link`, `data-tipo`) just scroll to the form and
    bump that scaffold type's quantity to 1 if it's currently 0.
- **Neither file has a backend** — every lead/feedback submission is handed off to WhatsApp
  (`wa.me` deep link); there is no server-side storage of quotes or feedback anywhere.

When adding a new scaffold/product type, you need to touch three places in tandem: a catalog card
in `index.html`, a matching quantity-stepper card in the `#cotizar` form (same `data-tipo` string),
and nothing in `script.js` (it discovers inputs generically via `.qty-input`/`data-tipo`).

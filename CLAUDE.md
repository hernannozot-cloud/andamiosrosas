# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single static marketing/quoting site for "Andamios Rosas", a scaffolding (andamios) rental
business in Toluca, Mexico. No framework, no build step, no package.json — plain HTML/CSS/JS
served as static files.

```
sitio-web/
  index.html      # entire site: header/nav, hero, catálogo, cómo-funciona, cotizar (quote form), contacto
  style.css       # all styling, CSS custom properties in :root (--pink, --dark, etc.)
  script.js       # all behavior (see below)
  assets/         # logo, favicon, icono_negro.png, assets/productos/*.jpg (product photos)
LOGOS/            # source brand assets (multiple logo variants, profile pics) — not referenced by the site directly
sitio-web.zip     # zipped copy of sitio-web/ for handoff/deployment (rebuilt manually, see below)
```

There is no git repository here — treat file edits as the only history; there's no `git log`/`git diff` to lean on.

## Running locally

No build tooling. Serve `sitio-web/` with any static file server, e.g.:

```bash
python -m http.server 8790
```

Then open `http://localhost:8790/`. There are no tests and no linter configured.

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

## Architecture of script.js (the only non-trivial logic)

Everything lives in one file, `sitio-web/script.js`, with no modules/bundler. Key pieces:

- **Config constants at top**: `WHATSAPP_NUMBER`, `PRECIO_POR_DIA` (price per scaffold per day, MXN),
  `TOLUCA_LAT`/`TOLUCA_LON` and `RADIO_ENTREGA_GRATIS_KM` (free-delivery radius). Update these for
  pricing or delivery-zone changes rather than touching the calculation logic.
- **Quote flow**: the "Cotizar" section has a quantity stepper per scaffold type (`.qty-input`,
  keyed by `data-tipo`), a days input, and an address field. `calcularTotal()` recomputes the total
  live (`PRECIO_POR_DIA × total scaffolds × días`) and decides free-delivery messaging via
  `distanciaKm()` (haversine distance from the geocoded address to Toluca's coordinates).
- **Address autocomplete**: debounced (450ms) calls to the public OpenStreetMap Nominatim API
  (`nominatim.openstreetmap.org/search`, no API key) biased toward the Toluca/CDMX viewbox, populates
  a suggestion list; selecting a suggestion sets `zonaCoords` used by the delivery-radius check.
- **Submit handler**: builds a plain-text summary of the selection and opens
  `https://wa.me/<WHATSAPP_NUMBER>?text=<encoded message>` — the site has no backend; every lead
  is handed off to WhatsApp.
- Catalog "Solicitar cotización" buttons (`.card-link`, `data-tipo`) just scroll to the form and
  bump that scaffold type's quantity to 1 if it's currently 0.

When adding a new scaffold/product type, you need to touch three places in tandem: a catalog card
in `index.html`, a matching quantity-stepper card in the `#cotizar` form (same `data-tipo` string),
and nothing in `script.js` (it discovers inputs generically via `.qty-input`/`data-tipo`).

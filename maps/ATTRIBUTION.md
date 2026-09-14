# Map resources

## Style

Original `apple-maps-dark.json` by dddevid:
https://github.com/dddevid/MapLibre-GL-JS-AppleMaps-Style
Commit: 851e82c96fa7d2bf66974fed8d53c64f684c7b35

The upstream README declares the style released under the MIT License. Its linked
LICENSE file was unavailable (404) at retrieval on 2026-09-10. The original JSON
is retained in `upstream/`, byte-for-byte. The runtime only replaces resource URLs,
adds data attribution and removes the unused broken
sprite URL. No layer, color, road width, label size, or label font is altered.

## Geographic data

© OpenStreetMap contributors, under the Open Database License:
https://www.openstreetmap.org/copyright
https://opendatacommons.org/licenses/odbl/1-0/

Tiles supplied by OpenFreeMap using the OpenMapTiles schema:
https://openfreemap.org/
https://openmaptiles.org/

Vector tiles are loaded directly from OpenFreeMap's live planet endpoint. There
is no cached regional dataset, prepared-area boundary, or offline-only mode.
The UI retains the data provider attribution.

## Fonts

Inter by Rasmus Andersson and contributors, SIL Open Font License 1.1.
See `fonts/INTER-OFL.txt`.
Source: https://github.com/google/fonts/tree/main/ofl/inter
Regular and Bold use static instances at optical size 14, weights 400 and 700;
Italic uses the italic source at optical size 14, weight 400.

The original Inter font names from the style are retained. SDF glyph files were
created with MapLibre's official font-maker WASM implementation:
https://github.com/maplibre/font-maker

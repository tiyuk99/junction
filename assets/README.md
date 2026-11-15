# Globe assets

- `countries.geojson` contains generalized 1:110m country outlines derived from Natural Earth Admin 0 country data. Natural Earth makes its public domain map data available at <https://www.naturalearthdata.com/downloads/110m-cultural-vectors/>. The GeoJSON conversion is from <https://github.com/datasets/geo-boundaries-world-110m>. `countries.js` embeds the same data for offline `file://` previews where browsers block data fetches.
- `travel-access.js` is a source-linked, profile-keyed sample of entry friction bands. It only colors destinations reviewed for the fictional India-passport / Finland-resident / tourism demo profile; other countries and profiles stay unassessed.
- The 1:110m outline source omits Singapore at this scale. Butler draws it as a small, labeled map marker rather than implying that marker is a precise border.
- `d3-geo.min.js` (D3 Geo 3.1.2) and `d3-array.min.js` (D3 Array 3.2.4) are vendored so the globe works without a runtime CDN. Their ISC license notices are in `D3-GEO-LICENSE.txt` and `D3-ARRAY-LICENSE.txt`.

The app uses an orthographic projection and spherical clipping to render the country polygons on a rotatable globe. Country boundary data is for visualization, not border or travel advice.

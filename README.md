# Butler · Travel readiness

A self-contained hackathon demo for personalized travel access. It includes a synthetic identity, interactive destination globe, destination research, multi-stop trip planning, an Exa evidence trail, and a printable document-preparation worksheet.

## Run

Requires Node.js 20 or newer.

```sh
npm start
```

Open <http://localhost:4173>. The globe uses locally bundled D3 Geo and Natural Earth country outlines; the app has no runtime CDN dependency.

## Live Exa research

Add your `EXA_API_KEY` to the ignored local `.env` file, then start the server:

```sh
npm start
```

The server uses Exa Search for traveler-specific entry checks, official travel advisories, document checklists, custom questions, and each saved trip leg. Search requests highlights with a 24-hour content freshness window plus a compact structured readout; Butler accepts a preparation band only when Exa grounding points to one of the returned allowlisted government sources. Each source is checked again server-side before it reaches the browser. Searches return at most four sources; identical profile/focus/question requests share a five-minute in-memory cache, Exa calls have a 15-second timeout, and the API limits paid requests to 10 per client IP per minute. Multi-stop research is capped at five destinations. These controls are process-local and reset when the server restarts. Butler does not make a visa or safety determination. Without a key, the UI uses clearly labeled source previews. Before the first live search, the user must explicitly opt into sending passport country, residence country, residence status, purpose, stay length, destination, and any typed question to Exa; name and passport number are never sent. The research console shows Exa's reported cost when available.

Profile defaults and starter map assessments are demo content; a successful, grounded Exa entry check can override the active profile’s band for that country. The document studio can print the travel pack or export the profile as JSON and the brief as Markdown; no application is submitted and no payments are processed.

## Personalized entry-friction map

`assets/travel-access.js` contains source-linked starter rulesets for the India-passport / Finland-resident demo traveler across tourism, study, work, and relocation. A successful live Exa entry check can add a profile-scoped country assessment and recolor that country; ungrounded bands stay **Not assessed**. New traveler profiles start without inheriting another traveler’s colors. Add reviewed country records under the normalized `passport|residence|purpose` key to extend curated coverage. The country browser searches every country outline bundled with the globe.

The four map bands describe preparation steps (exemption, online step, visa application, fuller application); they do not estimate approval odds or decide whether someone can enter. The demo records include official source links and a checked date because entry rules change. Country-specific long-stay records are conservative preparation guidance, not legal determinations. Use **Edit traveler profile** to change passport country, residence, permit/status, purpose, and trip length. That profile is stored in the current browser; unreviewed combinations stay neutral. Drag or scroll the globe to rotate and zoom, or use its zoom controls.

The document studio creates a purpose- and destination-specific starter checklist plus an editable Markdown travel brief. Checklist edits and drafts are stored locally in the current browser, scoped to the traveler profile and destination; users can download the brief or print the pack. Traveler-entered document worksheet fields are also saved locally per profile and can be cleared in the studio.

Saved destinations are kept per traveler profile and can be opened from the shortlist or added to the route. The trip builder saves up to five stops and dates per profile. Its preparation timeline creates five editable reminders relative to departure and remembers completion for that route. These local features work without an Exa key; explicit entry, advisory, document, and question research, plus trip-wide checks, use Exa when the user opts in.

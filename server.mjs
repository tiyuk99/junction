import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.geojson': 'application/geo+json; charset=utf-8' };
const port = Number(process.env.PORT || 4173);

const MAX_BODY_BYTES = 10_000;
const MAX_FORM_BODY_BYTES = 20_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_TRIP_STOPS = 5;
const MAX_CALLS_PER_MINUTE = 10;
const SEARCH_RESULT_COUNT = 4;
const CACHE_TTL_MS = 5 * 60_000;
const responseCache = new Map();
const pendingSearches = new Map();
const requestWindows = new Map();
const worldResearchRuns = new Map();
const worldResearchByProfile = new Map();
const countryFeatures = JSON.parse(readFileSync(join(root, 'assets/countries.geojson'), 'utf8')).features;
const worldCountryNames = [...new Set(countryFeatures.map((feature) => feature.properties?.admin).filter(Boolean))].sort();
const officialCountryCodes = new Set(countryFeatures.map((feature) => feature.properties?.iso_a2?.toLowerCase()).filter((code) => /^[a-z]{2}$/.test(code || '')));
const allowedPurposes = new Set(['Tourism', 'Business visit', 'Transit', 'Study', 'Work', 'Relocation', 'Family visit', 'Digital nomad']);
const allowedDurations = new Set(['7 days', '14 days', '30 days', '90 days', '1 year']);
const officialDomainPatterns = [...new Set([
  '*.gov',
  ...[...officialCountryCodes].flatMap((code) => [`gov.${code}`, `govt.${code}`, `gouv.${code}`, `gob.${code}`]),
  '*.europa.eu', 'europa.eu', 'gov.uk', 'gov.au', 'gov.sg', 'gc.ca', 'canada.ca', 'go.jp', 'go.kr', 'go.th',
  'mofa.go.jp', 'moj.go.jp', 'fi.emb-japan.go.jp', 'visa.go.kr', 'immigration.go.kr', 'overseas.mofa.go.kr',
  'ica.gov.sg', 'france-visas.gouv.fr', 'immi.homeaffairs.gov.au', 'ircc.canada.ca', 'helsinki.thaiembassy.org',
  'finlandabroad.fi', 'um.dk', 'dgdi.ga', 'consulat.ga', 'irishimmigration.ie', 'mfa-ks.net',
  'acces-maroc.ma', 'consulat.ma', 'namibiaembassy.be', 'namibiaembassyusa.org', 'ambacongo.org',
  'kdmid.ru', 'mfagovsomaliland.org', 'govsomaliland.org', 'thaiembassy.org', 'service-public.nc',
])];
const exactOfficialDomains = officialDomainPatterns.filter((domain) => !domain.startsWith('*'));

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function pdfPython() {
  const candidates = [process.env.BUTLER_PYTHON, 'python3', join(process.env.HOME || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const result = spawnSync(candidate, ['-c', 'import pypdf'], { encoding: 'utf8', timeout: 1500, stdio: 'ignore' });
    if (result.status === 0) return candidate;
  }
  throw httpError(503, 'PDF field support needs Python with pypdf installed.');
}

function runPdfForm(mode, pdf, values = {}) {
  const python = pdfPython();
  return new Promise((resolve, reject) => {
    const args = [join(root, 'scripts/pdf_form.py'), mode];
    if (mode === 'fill') args.push(JSON.stringify(values));
    const child = spawn(python, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; const errors = []; let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_PDF_BYTES + 1024 * 1024) { child.kill(); reject(httpError(413, 'Prepared PDF is too large.')); return; }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (errors.reduce((total, part) => total + part.length, 0) < 4000) errors.push(chunk); });
    child.on('error', () => reject(httpError(503, 'Python PDF processing is unavailable.')));
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(httpError(422, Buffer.concat(errors).toString('utf8').trim().slice(-500) || 'This PDF could not be prepared.')));
    child.stdin.end(pdf);
  });
}

async function downloadOfficialPdf(urlValue) {
  let target;
  try { target = new URL(urlValue); } catch { throw httpError(400, 'That file link is invalid.'); }
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !isOfficialGovernmentUrl(target.href)) throw httpError(403, 'Only HTTPS files hosted by an official government or embassy site can be opened here.');
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(target.href, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/pdf' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) throw httpError(502, 'The official file redirected too many times.');
    try { target = new URL(location, target); } catch { throw httpError(502, 'The official file redirected to an invalid address.'); }
    if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !isOfficialGovernmentUrl(target.href)) throw httpError(403, 'The file redirected outside an official government site.');
  }
  if (!response?.ok || !response.body) throw httpError(502, 'The official PDF could not be downloaded.');
  if (Number(response.headers.get('content-length') || 0) > MAX_PDF_BYTES) throw httpError(413, 'This PDF is larger than Butler can preview (15 MB).');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > MAX_PDF_BYTES) throw httpError(413, 'This PDF is larger than Butler can preview (15 MB).'); chunks.push(chunk); }
  const pdf = Buffer.concat(chunks);
  if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw httpError(415, 'The official link did not return a PDF file.');
  return pdf;
}

async function readJsonRequest(req, maxBytes) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > maxBytes) throw httpError(413, 'Request is too large.'); }
  try { return JSON.parse(body); } catch { throw httpError(400, 'Request body must be valid JSON.'); }
}

function cleanString(value, field, maxLength, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw httpError(400, `${field} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw httpError(400, `${field} is required.`);
  if (clean.length > maxLength || /[\u0000-\u001f\u007f]/.test(clean)) throw httpError(400, `${field} is invalid or too long.`);
  return clean;
}

function validateResearchInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'A JSON object is required.');
  if (value.exaConsent !== true) throw httpError(403, 'Traveler-context sharing with Exa has not been accepted.');
  const input = {
    passport: cleanString(value.passport, 'Passport country', 80),
    residence: cleanString(value.residence, 'Residence country', 80),
    destination: cleanString(value.destination, 'Destination', 80),
    purpose: cleanString(value.purpose || 'Tourism', 'Purpose', 40),
    duration: cleanString(value.duration || '14 days', 'Trip length', 20),
    residencePermit: cleanString(value.residencePermit || 'Residence status not specified', 'Residence status', 120),
    focus: cleanString(value.focus || 'entry', 'Research focus', 20),
    question: cleanString(value.question || '', 'Question', 400, false),
  };
  if (!allowedPurposes.has(input.purpose)) throw httpError(400, 'Choose a supported travel purpose.');
  if (!allowedDurations.has(input.duration)) throw httpError(400, 'Choose a supported trip length.');
  if (!['entry', 'documents', 'advisory', 'question', 'forms'].includes(input.focus)) throw httpError(400, 'Choose a supported research focus.');
  if (input.focus === 'question' && !input.question) throw httpError(400, 'Enter a question about travel entry, permits, documents, or government application steps.');
  if (input.focus === 'question' && !/\b(visa|immigration|entry|enter|border|passport|travel document|permit|residence|stay|transit|touris|business visit|study|student|work|employment|relocat|family|digital nomad|application|apply|government form|document|evidence|requirement|eligible|eligibility|embassy|consul|arrival|advisory|travel alert|appointment|fee|invitation|insurance|accommodation|funds|proof|waiver|exempt)\b/i.test(input.question)) {
    throw httpError(400, 'Butler research is limited to travel entry, visas and permits, travel documents, government application steps, and official travel advisories.');
  }
  return input;
}

function isOfficialGovernmentUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (exactOfficialDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    const officialCountryDomain = host.match(/\.(?:gov|govt|gouv|gob|go)\.([a-z]{2})$/);
    const officialGubDomain = host.match(/\.gub\.([a-z]{2})$/);
    return host.endsWith('.gov')
      || (officialCountryDomain && officialCountryCodes.has(officialCountryDomain[1]))
      || (officialGubDomain && officialCountryCodes.has(officialGubDomain[1]))
      || host.endsWith('.europa.eu');
  } catch { return false; }
}

function consumeRequest(ip) {
  const now = Date.now();
  const current = requestWindows.get(ip);
  if (!current || now - current.startedAt >= 60_000) {
    requestWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_CALLS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

function researchCacheKey(input) {
  return JSON.stringify([input.passport, input.residence, input.residencePermit, input.destination, input.purpose, input.duration, input.focus, input.question].map((part) => part.toLocaleLowerCase()));
}

function researchPlan(input) {
  const traveler = `Traveler: ${input.passport} passport holder, resident in ${input.residence} (${input.residencePermit}); purpose ${input.purpose}; stay ${input.duration}.`;
  if (input.focus === 'forms') return {
    query: `Find the actual downloadable government visa application PDF for a ${input.passport} passport holder legally resident in ${input.residence}, applying to travel to ${input.destination} for ${input.purpose} for ${input.duration}. ${traveler} Return direct official-government PDF files only; prioritize the application form itself, not instructions, agents, or general visa pages. If the authority uses an online portal and has no downloadable PDF, do not substitute a guidance page.`,
    objective: 'Find direct government-hosted PDF application files for this traveler route. Return only actual PDFs from official government or embassy sites. Exclude information pages and commercial visa services.',
    systemPrompt: 'Prefer the issuing government immigration or foreign-affairs authority and its embassy/consulate. Only claim a file is a form when its title or retrieved text identifies it as an application form for the selected purpose. Never return private visa-agent forms. If no direct PDF application form is available, return no form files.',
  };
  if (input.focus === 'documents') return {
    query: `For ${input.destination}, what documents and evidence does an applicant with this traveler profile need for a ${input.purpose} visit lasting ${input.duration}? ${traveler} Find current destination-government immigration and embassy checklists. Separate required documents from conditional or unverified items.`,
    objective: 'Build a short, source-backed preparation checklist from current destination government and embassy document instructions. Extract only documents explicitly supported by the official pages; distinguish mandatory from conditional; say when guidance could not be verified.',
    systemPrompt: 'Use only official government immigration, foreign-affairs, or embassy guidance. Extract documents explicitly stated on the page. Do not invent a checklist item or imply that a document is required when sources make it conditional. If the traveler-specific route cannot be verified, say so and return an empty steps array. This is planning guidance, never a legal decision.',
  };
  if (input.focus === 'advisory') return {
    query: `Current official travel advice, safety alerts, entry notices, and local emergency guidance for a ${input.passport} passport holder resident in ${input.residence} traveling to ${input.destination} for ${input.purpose} for ${input.duration}. Prioritize the foreign-affairs authority of the traveler's passport country and destination government advisories.`,
    objective: 'Surface current official travel advice relevant to the selected traveler and destination. Pull dated safety notices, entry alerts, and practical government instructions. Exclude unsourced claims and keep advice distinct from visa eligibility.',
    systemPrompt: 'Prefer official foreign-affairs and destination-government advisory pages. Report only claims supported by those pages; include notice dates when available. If there is no relevant advisory, say it was not found rather than implying the destination is safe. Do not provide a safety guarantee or entry decision.',
  };
  if (input.focus === 'question') return {
    query: `Answer this traveler question using current official government immigration, foreign-affairs, or embassy guidance for ${input.destination}: ${input.question}. ${traveler}`,
    objective: 'Answer only the traveler’s travel-entry, visa, permit, document, or government application question using the most relevant official government or embassy documents. Decline unrelated questions. Cite the source passages and state clearly what remains uncertain or profile-dependent.',
    systemPrompt: 'Answer only questions about travel entry, visas, permits, travel documents, official application steps, and travel-related government requirements. Decline unrelated questions. Use official government, immigration, foreign-affairs, or embassy pages. Answer only what those sources support, distinguish passport nationality from residence status and travel purpose, and explicitly say when information is missing or unclear. Never make a legal determination or guess.',
  };
  return {
    query: `Current visa, entry, passport-validity, residence-permit, and transit requirements for a ${input.passport} passport holder legally residing in ${input.residence} with ${input.residencePermit}, visiting ${input.destination} for ${input.purpose} for ${input.duration}. Prioritize destination-government immigration and official embassy guidance; distinguish nationality-dependent requirements from residence-status requirements.`,
    objective: 'Find authoritative government immigration or foreign-affairs documents for this traveler-specific entry-readiness check. Rank destination and official embassy guidance first; exclude travel blogs, visa agents, and forums. Pull steps that change by passport nationality, residence status, purpose, and trip length.',
    systemPrompt: 'Use official government immigration, foreign-affairs, or embassy guidance. Summarize the route and preparation burden, not the likelihood of approval or a legal conclusion. Choose lighter only when the source confirms no advance visa or appointment and no substantial extra application steps; some for a confirmed online or simple pre-travel step; more for a confirmed visa, appointment, or substantial application; unclear when the official evidence does not establish the route. List only source-supported next steps.',
  };
}
const researchOutputSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    preparationBand: { type: 'string', enum: ['lighter', 'some', 'more', 'unclear'] },
    steps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
  },
  required: ['summary', 'preparationBand', 'steps'],
};

async function research(input, clientIp) {
  if (!process.env.EXA_API_KEY) return { mode: 'demo', sources: demoSources(input.destination), note: 'EXA_API_KEY is not configured. These sample sources are for interface demonstration only.' };
  const key = researchCacheKey(input);
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return { ...cached.result, cached: true };
  if (cached) responseCache.delete(key);
  if (pendingSearches.has(key)) return { ...(await pendingSearches.get(key)), cached: true };
  if (!consumeRequest(clientIp)) throw httpError(429, 'Search limit reached. Wait a minute before searching again.');
  const plan = researchPlan(input);
  const request = (async () => {
    let response;
    try {
      response = await fetch('https://api.exa.ai/search', {
        method: 'POST', headers: { 'x-api-key': process.env.EXA_API_KEY, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          query: plan.query,
          type: 'auto',
          objective: plan.objective,
          systemPrompt: plan.systemPrompt,
          ...(input.focus === 'forms' ? {} : { outputSchema: researchOutputSchema }),
          includeDomains: officialDomainPatterns,
          numResults: SEARCH_RESULT_COUNT,
          contents: { highlights: true, maxAgeHours: 24 },
        }),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw httpError(504, 'Exa search timed out. Please try again.');
      throw httpError(502, 'Could not connect to Exa. Please try again.');
    }
    if (!response.ok) throw httpError(502, `Exa search failed (${response.status}). Please try again.`);
    let data;
    try { data = await response.json(); } catch { throw httpError(502, 'Exa returned an unreadable response. Please try again.'); }
    const sources = (Array.isArray(data.results) ? data.results : [])
      .filter((result) => isOfficialGovernmentUrl(result.url))
      .slice(0, SEARCH_RESULT_COUNT)
      .map((result) => ({ title: result.title, url: result.url, text: Array.isArray(result.highlights) ? result.highlights.join(' ') : '', publishedDate: result.publishedDate }));
    const rawInsights = input.focus !== 'forms' && data.output?.content && typeof data.output.content === 'object' ? data.output.content : null;
    const rawGrounding = Array.isArray(data.output?.grounding) ? data.output.grounding : [];
    const groundingFor = (field) => rawGrounding.find((item) => item.field === field && item.confidence !== 'low');
    const citedSourcesFor = (field) => {
      const citations = groundingFor(field)?.citations;
      return Array.isArray(citations) ? citations.filter((citation) => isOfficialGovernmentUrl(citation.url) && sources.some((source) => source.url === citation.url)).map(({ url, title }) => ({ url, title })) : [];
    };
    const rawSteps = Array.isArray(rawInsights?.steps) ? rawInsights.steps : [];
    const groundedSteps = rawSteps.flatMap((step, index) => {
      if (typeof step !== 'string' || !step.trim()) return [];
      const field = citedSourcesFor(`steps[${index}]`).length ? `steps[${index}]` : 'steps';
      const citations = citedSourcesFor(field);
      return citations.length ? [{ text: step.trim(), citations }] : [];
    });
    const summaryCitations = citedSourcesFor('summary');
    const bandCitations = citedSourcesFor('preparationBand');
    const groundedBand = input.focus === 'entry' && bandCitations.length ? rawInsights?.preparationBand : 'unclear';
    const insights = rawInsights ? {
      summary: summaryCitations.length ? String(rawInsights.summary || '') : '',
      summaryCitations,
      preparationBand: ['lighter', 'some', 'more'].includes(groundedBand) ? groundedBand : 'unclear',
      steps: groundedSteps,
    } : null;
    const files = input.focus === 'forms' ? (Array.isArray(data.results) ? data.results : []).flatMap((item) => {
      try {
        const url = new URL(item.url);
        const title = String(item.title || 'Government application form').slice(0, 180);
        const evidence = `${title} ${(item.highlights || []).join(' ')}`;
        if (!isOfficialGovernmentUrl(url.href) || !url.pathname.toLowerCase().endsWith('.pdf') || !/visa|residence|immigration|entry/i.test(evidence) || !/application|form/i.test(evidence)) return [];
        return [{ title, url: url.href, sourceTitle: title, checkedOn: new Date().toISOString().slice(0, 10) }];
      } catch { return []; }
    }).slice(0, 4) : [];
    const result = {
      mode: 'live', focus: input.focus, requestId: data.requestId, sources, officialOnly: true,
      files,
      insights,
      grounding: rawGrounding.flatMap((item) => {
        const citations = Array.isArray(item.citations) ? item.citations.filter((citation) => sources.some((source) => source.url === citation.url)).map(({ url, title }) => ({ url, title })) : [];
        return citations.length ? [{ field: item.field, confidence: item.confidence, citations }] : [];
      }),
      costDollars: data.costDollars || null,
      note: sources.length
        ? 'Exa source discovery, restricted to government and official-authority domains. This is not a visa determination; confirm requirements with the linked authority.'
        : input.focus === 'forms' ? 'No direct official PDF application form was found in the results. The authority may use an online application portal, or the search could not verify a downloadable form. Open the listed official pages to check.' : 'Exa found no results on the approved government-domain allowlist. Try a more specific destination or verify directly with its immigration authority.',
    };
    responseCache.set(key, { savedAt: Date.now(), result });
    if (responseCache.size > 100) responseCache.delete(responseCache.keys().next().value);
    return result;
  })();
  pendingSearches.set(key, request);
  try { return await request; }
  finally { pendingSearches.delete(key); }
}

const worldOutputSchema = {
  type: 'object', additionalProperties: false, required: ['countries'],
  properties: { countries: { type: 'array', minItems: worldCountryNames.length, maxItems: worldCountryNames.length, items: {
    type: 'object', additionalProperties: false,
    required: ['country', 'preparationBand', 'summary', 'steps', 'sources'],
    properties: {
      country: { type: 'string' },
      preparationBand: { type: 'string', enum: ['lighter', 'some', 'more', 'unclear'] },
      summary: { type: 'string', maxLength: 500 },
      steps: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 220 } },
      sources: { type: 'array', maxItems: 3, items: {
        type: 'object', additionalProperties: false, required: ['title', 'url'],
        properties: { title: { type: 'string', maxLength: 140 }, url: { type: 'string', format: 'uri' } },
      } },
    },
  } } },
};

function worldResearchKey(input) {
  return JSON.stringify([input.passport, input.residence, input.residencePermit, input.purpose, input.duration].map((part) => part.toLocaleLowerCase()));
}

function bundledWorldResearchResult(input) {
  try {
    const asset = readFileSync(join(root, 'assets/world-research.js'), 'utf8');
    const match = asset.match(/window\.BUTLER_WORLD_RESEARCH\s*=\s*(\{[\s\S]*\});\s*$/);
    if (!match) return null;
    const profileKey = [input.passport, input.residence, input.residencePermit, input.purpose, input.duration].map((part) => part.toLocaleLowerCase()).join('|');
    const profile = JSON.parse(match[1]).profiles?.[profileKey];
    if (!profile) return null;
    const countries = worldCountryNames.map((country) => {
      const record = profile.countries?.[country];
      const preparationBand = ({ 1: 'lighter', 2: 'some', 3: 'more', 4: 'more', unknown: 'unclear' })[record?.level] || 'unclear';
      return { country, preparationBand, summary: record?.route || 'Exa did not return an approved official citation for this destination.', steps: record?.detail ? record.detail.split(' · ').slice(0, 4) : [], sources: record?.sources || [] };
    });
    const grounding = countries.flatMap((item, index) => item.sources.length ? [{ field: `structured.countries[${index}]`, citations: item.sources }] : []);
    return { id: null, status: 'completed', budgetCap: 5, cached: true, countries, grounding, costDollars: { total: Number(profile.costDollars || 0) }, stopReason: profile.stopReason || 'schema_satisfied' };
  } catch { return null; }
}

async function startWorldResearch(input) {
  const key = worldResearchKey(input);
  const existing = worldResearchByProfile.get(key);
  if (existing && ['queued', 'running'].includes(existing.status)) return existing;
  if (existing?.status === 'completed' && Date.now() - Date.parse(existing.completedAt || existing.createdAt) < 24 * 60 * 60 * 1000) return existing;
  const query = `Research every destination in the supplied input.data for this traveler: ${input.passport} ordinary passport holder, resident in ${input.residence} with ${input.residencePermit}; purpose ${input.purpose}; trip length ${input.duration}. For each destination, return the current entry-preparation route and source-supported next steps from that destination's official immigration, visa, foreign-affairs authority, or official embassy/consulate.`;
  const systemPrompt = `This is a high-stakes travel planning dataset. Research each supplied destination separately. Use only primary official government immigration, visa, foreign-affairs, or embassy/consulate evidence. Return every supplied country exactly once. Every country must cite official evidence actually retrieved; never invent or guess a URL. If the traveler's exact route cannot be established, use preparationBand unclear and explain the gap. preparationBand describes preparation burden, never approval likelihood or a legal decision: lighter only when official evidence confirms no advance visa or substantial application; some for a confirmed simple online/pre-travel step; more for a confirmed visa, appointment, or substantial application; unclear when evidence is missing, contradictory, or not traveler-specific. Distinguish passport nationality from residence status. Include source URLs from the evidence and preserve uncertainty.`;
  const response = await fetch('https://api.exa.ai/agent/runs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EXA_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      query, systemPrompt, input: { data: worldCountryNames.map((country) => ({ country })) },
      outputSchema: worldOutputSchema, effort: 'auto', budget: { maxCostDollars: 5 },
    }),
  });
  if (!response.ok) throw httpError(502, `Exa world research could not start (${response.status}).`);
  const run = await response.json();
  const record = { id: run.id, profileKey: key, status: run.status, budgetCap: 5, createdAt: new Date().toISOString() };
  worldResearchRuns.set(run.id, record);
  worldResearchByProfile.set(key, record);
  return record;
}

function validateWorldResearchInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'A JSON object is required.');
  if (value.exaConsent !== true) throw httpError(403, 'Traveler-context sharing with Exa has not been accepted.');
  const input = {
    passport: cleanString(value.passport, 'Passport country', 80),
    residence: cleanString(value.residence, 'Residence country', 80),
    residencePermit: cleanString(value.residencePermit || 'Residence status not specified', 'Residence status', 120),
    purpose: cleanString(value.purpose || 'Tourism', 'Purpose', 40),
    duration: cleanString(value.duration || '14 days', 'Trip length', 20),
  };
  if (!allowedPurposes.has(input.purpose)) throw httpError(400, 'Choose a supported travel purpose.');
  if (!allowedDurations.has(input.duration)) throw httpError(400, 'Choose a supported trip length.');
  return input;
}

async function pollWorldResearch(run) {
  if (run.status === 'completed' && run.result) return { id: run.id, status: run.status, budgetCap: run.budgetCap, ...run.result };
  const response = await fetch(`https://api.exa.ai/agent/runs/${encodeURIComponent(run.id)}`, {
    headers: { Authorization: `Bearer ${process.env.EXA_API_KEY}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw httpError(502, `Exa world research status failed (${response.status}).`);
  const data = await response.json();
  run.status = data.status;
  run.stopReason = data.stopReason || null;
  run.costDollars = data.costDollars || null;
  if (!['completed', 'failed', 'cancelled'].includes(data.status)) return { id: run.id, status: data.status, budgetCap: run.budgetCap };
  const structured = data.output?.structured || null;
  const grounding = Array.isArray(data.output?.grounding) ? data.output.grounding.map((item) => ({
    field: item.field,
    confidence: item.confidence,
    citations: Array.isArray(item.citations) ? item.citations.filter((citation) => isOfficialGovernmentUrl(citation.url)).map(({ url, title }) => ({ url, title })) : [],
  })).filter((item) => item.citations.length) : [];
  const countries = Array.isArray(structured?.countries) ? structured.countries.flatMap((item) => {
    if (!worldCountryNames.includes(item.country)) return [];
    const sources = (Array.isArray(item.sources) ? item.sources : []).filter((source) => isOfficialGovernmentUrl(source.url)).map(({ title, url }) => ({ title, url }));
    return [{ country: item.country, preparationBand: ['lighter', 'some', 'more', 'unclear'].includes(item.preparationBand) ? item.preparationBand : 'unclear', summary: String(item.summary || '').slice(0, 500), steps: (Array.isArray(item.steps) ? item.steps : []).filter((step) => typeof step === 'string').slice(0, 4).map((step) => step.slice(0, 220)), sources }];
  }) : [];
  run.result = { countries, grounding, costDollars: run.costDollars, stopReason: run.stopReason };
  run.completedAt = new Date().toISOString();
  return { id: run.id, status: data.status, budgetCap: run.budgetCap, ...run.result };
}

function demoSources(destination) {
  const links = destination === 'Japan'
    ? [['Ministry of Foreign Affairs of Japan', 'https://www.mofa.go.jp/j_info/visit/visa/'], ['Immigration Services Agency of Japan', 'https://www.moj.go.jp/isa/']]
    : destination === 'South Korea' ? [['Korea Visa Portal', 'https://www.visa.go.kr/'], ['Korea Immigration Service', 'https://www.immigration.go.kr/']]
    : [['Official immigration information', 'https://europa.eu/youreurope/citizens/travel/entry-exit/non-eu-nationals/index_en.htm'], ['Ministry for Foreign Affairs', 'https://um.fi/']];
  return links.map(([title, url]) => ({ title, url, text: 'Official source link preview. Connect an Exa API key to retrieve current search results and page content.' }));
}

const handler = async (req, res) => {
  const allowedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const requestOrigin = req.headers.origin;
  const sameDeploymentOrigin = requestOrigin && req.headers.host && new URL(requestOrigin).host === req.headers.host;
  if (requestOrigin && !allowedOrigins.includes(requestOrigin) && !sameDeploymentOrigin) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Cross-origin requests are not allowed.' }));
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ exaConfigured: Boolean(process.env.EXA_API_KEY), officialOnly: true, maxTripStops: MAX_TRIP_STOPS, resultsPerSearch: SEARCH_RESULT_COUNT }));
  }
  if (req.method === 'POST' && req.url === '/api/pdf-autofill') {
    try {
      if (!process.env.EXA_API_KEY) throw httpError(503, 'AI suggestions need a configured Exa key.');
      const body = await readJsonRequest(req, MAX_FORM_BODY_BYTES);
      if (body.exaConsent !== true || body.formAiConsent !== true) throw httpError(403, 'Review and accept the form autofill data sharing first.');
      if (!consumeRequest(req.socket.remoteAddress || 'local')) throw httpError(429, 'Form autofill limit reached. Wait a minute before trying again.');
      if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile)) throw httpError(400, 'Profile details are missing.');
      const profile = {};
      for (const [key, label] of Object.entries({ fullName: 'Full name', nationality: 'Nationality', passportExpiry: 'Passport expiry', residence: 'Residence', permitType: 'Residence permit type', permitExpiry: 'Residence permit expiry', purpose: 'Purpose', duration: 'Trip duration', departureDate: 'Departure date for this application', purposeNotes: 'Application purpose notes', accommodation: 'Accommodation' })) {
        if (typeof body.profile[key] === 'string' && body.profile[key].trim()) profile[label] = cleanString(body.profile[key], label, 180, false);
      }
      if (!Object.keys(profile).length) throw httpError(400, 'Add profile details before asking for suggestions.');
      const pdf = await downloadOfficialPdf(body.url);
      const fields = JSON.parse((await runPdfForm('fields', pdf)).toString('utf8')).filter((field) => ['text', 'choice'].includes(field.kind)).slice(0, 100);
      const publicFields = fields.map(({ name, label, kind, options }) => ({ name, label, kind, options }));
      const schema = { type: 'object', additionalProperties: false, required: ['suggestions'], properties: { suggestions: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['field', 'answer'], properties: { field: { type: 'string' }, answer: { type: 'string', maxLength: 180 } } } } } };
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST', headers: { 'x-api-key': process.env.EXA_API_KEY, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          query: `For each official PDF form field, match a profile value only when its meaning is an exact fit. Do not guess. Return an empty answer for any field not directly supplied. Exact profile values: ${JSON.stringify(profile)}. Form fields and allowed select options: ${JSON.stringify(publicFields)}.`,
          type: 'auto', objective: 'Map only explicit profile details to matching fillable form fields; leave unknown official-form details blank.',
          systemPrompt: 'You are matching provided traveler profile values to labels of an official visa form. Never infer or invent facts, translate values, or fill identity numbers, dates of birth, addresses, application IDs, or other details not explicitly supplied. Return a value only if it is explicitly present in profile and clearly matches the field. For choice fields use an exact listed option or leave blank. Return at most 40 suggestions. This is a draft for human review, not a submitted application.',
          outputSchema: schema, includeDomains: [new URL(body.url).hostname], numResults: 1, contents: { highlights: false, maxAgeHours: 24 },
        }),
      });
      if (!response.ok) throw httpError(502, `Exa could not map this form (${response.status}).`);
      const data = await response.json();
      const suggestions = data.output?.content?.suggestions || [];
      const allowedFields = new Map(fields.map((field) => [field.name, field]));
      const filled = {};
      for (const item of suggestions) {
        const field = allowedFields.get(item.field);
        const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
        if (field && answer && Object.values(profile).includes(answer) && answer.length <= 180 && (!field.options.length || field.options.includes(answer))) filled[field.name] = answer;
      }
      const requiredFields = fields.filter((field) => field.required && !filled[field.name]).slice(0, 30);
      const review = [
        ...Object.entries(filled).map(([name, answer]) => ({ ...allowedFields.get(name), answer, suggested: true })),
        ...requiredFields.map((field) => ({ ...field, answer: '', suggested: false })),
      ];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ fields: review, suggestions: Object.keys(filled).length, requiredRemaining: requiredFields.length }));
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'Could not prepare the application draft.' }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/pdf-prepare') {
    try {
      const body = await readJsonRequest(req, MAX_FORM_BODY_BYTES);
      if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw httpError(400, 'Review the form answers first.');
      const pdf = await downloadOfficialPdf(body.url);
      const fields = JSON.parse((await runPdfForm('fields', pdf)).toString('utf8'));
      const allowedFields = new Map(fields.filter((field) => ['text', 'choice'].includes(field.kind)).map((field) => [field.name, field]));
      const values = {};
      for (const [name, rawValue] of Object.entries(body.values).slice(0, 100)) {
        const field = allowedFields.get(name);
        if (!field || typeof rawValue !== 'string' || !rawValue.trim()) continue;
        const value = cleanString(rawValue, field.label || 'Form answer', 500, false);
        if (field.options.length && !field.options.includes(value)) throw httpError(400, `Choose one of the official options for “${field.label}”.`);
        values[name] = value;
      }
      if (!Object.keys(values).length) throw httpError(400, 'Add at least one answer before building the PDF.');
      const result = await runPdfForm('fill', pdf, values);
      const missing = fields.filter((field) => field.required && !values[field.name]).slice(0, 30).map((field) => ({ label: String(field.label || 'Required field').replace(/[\r\n]/g, ' ').slice(0, 120) }));
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="butler-application-review.pdf"', 'Content-Length': result.length, 'X-Prepared-Field-Count': String(Object.keys(values).length), 'X-Missing-Required-Fields': JSON.stringify(missing), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(result);
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 422;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'Could not build the review PDF.' }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/research') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw httpError(413, 'Request is too large.'); }
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw httpError(400, 'Request body must be valid JSON.'); }
      const input = validateResearchInput(parsed);
      const clientIp = req.socket.remoteAddress || 'local';
      const result = await research(input, clientIp);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result));
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (status === 429) res.setHeader('Retry-After', '60');
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'Research failed.' }));
    }
    return;
  }
  const officialFileUrl = req.method === 'GET' && req.url.startsWith('/api/official-file?')
    ? new URL(req.url, `http://localhost:${port}`).searchParams.get('url') : null;
  if (officialFileUrl !== null) {
    try {
      let target;
      try { target = new URL(officialFileUrl); } catch { throw httpError(400, 'That file link is invalid.'); }
      if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !isOfficialGovernmentUrl(target.href)) throw httpError(403, 'Only HTTPS files hosted by an official government or embassy site can be opened here.');
      let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await fetch(target.href, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/pdf' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirects === 3) throw httpError(502, 'The official file redirected too many times.');
        try { target = new URL(location, target); } catch { throw httpError(502, 'The official file redirected to an invalid address.'); }
        if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !isOfficialGovernmentUrl(target.href)) throw httpError(403, 'The file redirected outside an official government site.');
      }
      if (!response?.ok || !response.body) throw httpError(502, 'The official PDF could not be downloaded.');
      const declaredSize = Number(response.headers.get('content-length') || 0);
      if (declaredSize > 15 * 1024 * 1024) throw httpError(413, 'This PDF is larger than Butler can preview (15 MB).');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 15 * 1024 * 1024) throw httpError(413, 'This PDF is larger than Butler can preview (15 MB).');
        chunks.push(chunk);
      }
      const pdf = Buffer.concat(chunks);
      if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw httpError(415, 'The official link did not return a PDF file.');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="official-application.pdf"', 'Content-Length': pdf.length, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' });
      res.end(pdf);
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(error.message || 'Could not open this PDF.');
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/world-research') {
    try {
      if (!process.env.EXA_API_KEY) throw httpError(503, 'EXA_API_KEY is not configured on this server.');
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw httpError(413, 'Request is too large.'); }
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw httpError(400, 'Request body must be valid JSON.'); }
      const input = validateWorldResearchInput(parsed);
      const bundled = bundledWorldResearchResult(input);
      if (bundled) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(bundled));
        return;
      }
      const run = await startWorldResearch(input);
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ id: run.id, status: run.status, budgetCap: run.budgetCap, countryCount: worldCountryNames.length }));
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'World research failed to start.' }));
    }
    return;
  }
  const worldRunMatch = req.method === 'GET' && req.url.match(/^\/api\/world-research\/(agent_run_[a-zA-Z0-9_-]+)$/);
  if (worldRunMatch) {
    try {
      if (!process.env.EXA_API_KEY) throw httpError(503, 'EXA_API_KEY is not configured on this server.');
      const run = worldResearchRuns.get(worldRunMatch[1]);
      if (!run) throw httpError(404, 'This world research run is not available in the current server session.');
      const result = await pollWorldResearch(run);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message || 'World research status failed.' }));
    }
    return;
  }
  const requested = req.url === '/' ? '/index.html' : decodeURIComponent((req.url || '/').split('?')[0]);
  const file = normalize(join(root, requested));
  if (file !== root && !file.startsWith(`${root}/`)) { res.writeHead(403); return res.end('Forbidden'); }
  try { const content = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(content); }
  catch { res.writeHead(404); res.end('Not found'); }
};

export default handler;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(port, '127.0.0.1', () => console.log(`Butler is ready at http://localhost:${port}`));
}

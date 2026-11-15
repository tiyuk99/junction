const FILE_PREVIEW = location.protocol === 'file:';
const API_BASE = '';
const EXA_CONSENT_KEY = 'butler-exa-personalized-search-consent';
const destinations = {
  Japan: { flag: '🇯🇵', code: 'TYO', city: 'Tokyo', region: 'East Asia' },
  'South Korea': { flag: '🇰🇷', code: 'SEL', city: 'Seoul', region: 'East Asia' },
  Thailand: { flag: '🇹🇭', code: 'BKK', city: 'Bangkok', region: 'Southeast Asia' },
  'United Kingdom': { flag: '🇬🇧', code: 'LON', city: 'London', region: 'Europe' },
  France: { flag: '🇫🇷', code: 'PAR', city: 'Paris', region: 'Europe' },
  Singapore: { flag: '🇸🇬', code: 'SIN', city: 'Singapore', region: 'Southeast Asia' },
  Australia: { flag: '🇦🇺', code: 'SYD', city: 'Sydney', region: 'Oceania' },
  Canada: { flag: '🇨🇦', code: 'YVR', city: 'Vancouver', region: 'North America' },
};
const demoFlags = { India: '🇮🇳', Finland: '🇫🇮', Germany: '🇩🇪', 'United States': '🇺🇸', China: '🇨🇳', Brazil: '🇧🇷', Canada: '🇨🇦', Australia: '🇦🇺', 'United Kingdom': '🇬🇧' };
const countryFeatureByName = new Map((window.BUTLER_COUNTRIES?.features || []).map((feature) => [feature.properties?.admin, feature]));
const flagForCountry = (country) => {
  const code = countryFeatureByName.get(country)?.properties?.iso_a2;
  return demoFlags[country] || (code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))) : '🌐');
};
const byId = (id) => document.getElementById(id);
const documentProfileFields = ['docName', 'docNationality', 'docPassportExpiry', 'docResidence', 'docPermit', 'docPermitExpiry', 'docDates', 'docStay', 'docEmergency'];
function buildPageShell() {
  const main = byId('top');
  const explore = document.createElement('div');
  explore.id = 'page-explore'; explore.className = 'app-page'; explore.dataset.appPage = 'explore';
  [...main.children].forEach((node) => explore.append(node));
  main.append(explore);
  for (const [dialogId, page, index, label] of [['documentsDialog', 'documents', '04', 'DOCUMENT WORKSPACE']]) {
    const dialog = byId(dialogId);
    const screen = document.createElement('section');
    screen.id = `page-${page}`; screen.className = `app-page workspace-page ${page}-workspace`;
    screen.dataset.appPage = page;
    const topline = document.createElement('div');
    topline.className = 'workspace-topline';
    topline.innerHTML = `<span class="section-index">${index} / ${label}</span><a href="#explore" data-page-route="explore">← Back to Explore</a>`;
    screen.append(topline);
    [...dialog.children].forEach((node) => {
      if (node.matches('form[method="dialog"]')) return;
      screen.append(node);
    });
    dialog.remove();
    main.append(screen);
  }
}
buildPageShell();
function navigateToPage(page, updateLocation = true) {
  const validPage = ['explore', 'documents'].includes(page) ? page : 'explore';
  document.querySelectorAll('[data-app-page]').forEach((screen) => {
    const active = screen.dataset.appPage === validPage;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  document.querySelectorAll('[data-page-route]').forEach((link) => {
    const active = link.dataset.pageRoute === validPage;
    link.classList.toggle('active', active && link.closest('nav'));
    if (link.closest('nav')) link.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (updateLocation && location.hash !== `#${validPage}`) history.pushState({ page: validPage }, '', `#${validPage}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function isPageActive(page) { return byId(`page-${page}`)?.classList.contains('active') || false; }
document.querySelectorAll('[data-page-route]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  if (link.dataset.pageRoute === 'documents') openDocuments();
  else navigateToPage('explore');
}));
window.addEventListener('popstate', () => navigateToPage(location.hash.slice(1), false));
window.addEventListener('hashchange', () => navigateToPage(location.hash.slice(1), false));
const initialPage = location.hash === '#documents' ? 'documents' : 'explore';
navigateToPage(initialPage, false);
let activeCountry = 'Japan';
let lastResearch = null;

let setGlobeDestination = () => {};
let refreshHeroGlobe = () => {};
let refreshGlobeProfile = () => {};
const storedTravelerProfile = (() => { try { return JSON.parse(localStorage.getItem('butler-traveler-profile') || '{}'); } catch { return {}; } })();
let travelerName = storedTravelerProfile.name || 'Aarav Sharma';
let travelerProfile = {
  passport: storedTravelerProfile.passport || 'India',
  residence: storedTravelerProfile.residence || 'Finland',
  purpose: storedTravelerProfile.purpose || 'Tourism',
  duration: storedTravelerProfile.duration || '14 days',
  permitType: storedTravelerProfile.permitType || 'Student residence permit',
};
let renderAccessMap = () => {};
let activeWorldResearchProfile = null;
function accessProfileKey(profile = travelerProfile) {
  return [profile.passport, profile.residence, profile.purpose].map((value) => String(value || '').trim().toLowerCase()).join('|');
}
function worldProfileKey(profile = travelerProfile) {
  return [profile.passport, profile.residence, profile.permitType, profile.purpose, profile.duration].map((value) => String(value || '').trim().toLowerCase()).join('|');
}
function exaAssessmentStorageKey(profile = travelerProfile) {
  return `butler-exa-assessments:${[profile.passport, profile.residence, profile.purpose, profile.permitType, profile.duration].map((value) => String(value || '').trim().toLowerCase()).join('|')}`;
}
let cachedExaAssessmentsKey = '';
let cachedExaAssessments = {};
function liveAssessments() {
  const key = exaAssessmentStorageKey();
  if (key !== cachedExaAssessmentsKey) { cachedExaAssessments = readJSON(key, {}); cachedExaAssessmentsKey = key; }
  return cachedExaAssessments;
}
const firstScanProfileKey = 'india|finland|student residence permit|tourism|14 days';
function firstScanAssessment(name) {
  if (worldProfileKey() !== firstScanProfileKey) return null;
  const row = window.BUTLER_WORLD_RESEARCH?.profiles?.[firstScanProfileKey]?.countries?.[name];
  const unresolved = /not established|does not establish|not retrieved|could not|couldn't|cannot establish|not confirmed|insufficient|no destination-government source|route.*unclear/i.test(row?.route || '');
  if (![1, 2, 3].includes(row?.level) || unresolved || !row.sources?.some((source) => /^https:\/\//i.test(source.url || ''))) return null;
  return { ...row, origin: 'exa-first-scan' };
}
function accessAssessment(name = activeCountry) {
  if (name.trim().toLocaleLowerCase() === travelerProfile.passport.trim().toLocaleLowerCase() && name === 'India') {
    return {
      origin: 'home-country', level: 1, checkedOn: '2026-11-14', route: 'Return to India · no visa required',
      detail: 'Indian passport holders do not need a visa to travel to India.',
      sources: [{ title: 'MEA · Ready Referencer for Overseas Indian Citizens', url: 'https://meacms.mea.gov.in/images/pdf/ReadyReferencerforOverseasIndianOIFCREPORT.pdf', text: 'The Ministry of External Affairs says an Indian citizen ordinarily residing outside India and holding an Indian passport does not require a visa to travel to India.' }],
    };
  }
  const candidate = liveAssessments()[name] || null;
  const liveRecord = candidate?.reviewedClaim === true ? candidate : null;
  const scanRecord = firstScanAssessment(name);
  const demoProfileMatches = accessProfileKey() === 'india|finland|tourism' && travelerProfile.permitType.trim().toLowerCase() === 'student residence permit' && travelerProfile.duration === '14 days';
  const curatedRecord = demoProfileMatches ? window.BUTLER_TRAVEL_ACCESS?.profiles?.[accessProfileKey()]?.countries?.[name] : null;
  const record = liveRecord || scanRecord || null;
  const durationDays = Number.parseInt(travelerProfile.duration, 10) || 0;
  return record?.maxStayDays && durationDays > record.maxStayDays ? null : record;
}
function saveLiveAssessment(result, profile = travelerProfile) {
  const cited = [...(result.insights?.summaryCitations || []), ...(result.insights?.steps || []).flatMap((step) => step.citations || [])];
  const citedUrls = new Set(cited.map((item) => item.url));
  if (result.focus !== 'entry' || result.mode !== 'live' || !allCountryNames.includes(result.destination) || !result.insights || !['lighter', 'some', 'more', 'unclear'].includes(result.insights.preparationBand) || !result.sources?.some((source) => citedUrls.has(source.url))) return;
  const storageKey = exaAssessmentStorageKey(profile);
  const records = storageKey === exaAssessmentStorageKey() ? liveAssessments() : readJSON(storageKey, {});
  records[result.destination] = {
    origin: 'exa', reviewedClaim: true, level: { lighter: 1, some: 2, more: 3, unclear: 'unknown' }[result.insights.preparationBand],
    checkedOn: new Date().toISOString().slice(0, 10),
    route: result.insights.summary || 'Current official route researched with Exa',
    detail: (Array.isArray(result.insights.steps) ? result.insights.steps : []).map((step) => step.text).join(' · '),
    preparationSteps: (Array.isArray(result.insights.steps) ? result.insights.steps : []).filter((step) => typeof step.text === 'string' && step.text.trim()).map((step) => {
      const urls = new Set((step.citations || []).map((citation) => citation.url).filter(Boolean));
      return { text: step.text.slice(0, 240), sources: result.sources.filter((source) => urls.has(source.url)).map(({ title, url }) => ({ title, url })) };
    }),
    sources: result.sources,
  };
  try { localStorage.setItem(storageKey, JSON.stringify(records)); } catch {}
}
function worldRunStorageKey(profile = travelerProfile) { return `butler-world-run:${worldProfileKey(profile)}`; }
function setWorldResearchStatus(message, state = '') {
  const status = byId('worldResearchStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}
function applyWorldResearchResult(result, profile = travelerProfile) {
  const rows = Array.isArray(result.countries) ? result.countries : [];
  const grounding = Array.isArray(result.grounding) ? result.grounding : [];
  let grounded = 0;
  let banded = 0;
  let unclear = 0;
  let unsupported = 0;
  rows.forEach((row, index) => {
    if (!allCountryNames.includes(row.country)) return;
    const prefix = `structured.countries[${index}]`;
    const citations = [...new Map(grounding
      .filter((item) => String(item.field || '').startsWith(prefix))
      .flatMap((item) => Array.isArray(item.citations) ? item.citations : [])
      .filter((citation) => citation?.url && /^https:\/\//i.test(citation.url))
      .map((citation) => [citation.url, { title: citation.title || row.country, url: citation.url }])).values()];
    const rowSources = Array.isArray(row.sources) ? row.sources : [];
    const sources = rowSources.filter((source) => citations.some((citation) => citation.url === source.url));
    const verifiedSources = sources.length ? sources : citations;
    if (!verifiedSources.length) { unsupported++; return; }
    grounded++;
    // Bulk citations are not claim-level evidence; keep these records neutral until individually reviewed.
    unclear++;
  });
  const isCurrentProfile = worldProfileKey(profile) === worldProfileKey();
  if (isCurrentProfile) {
    renderAccessMap();
    refreshGlobeProfile();
    renderShortlist();

  }
  const cost = Number(result.costDollars?.total || 0);
  if (isCurrentProfile) setWorldResearchStatus(`Exa grounded ${grounded} of ${rows.length} countries · ${banded} have a prep band · ${unclear} remain neutral · ${unsupported} without allowed citations · $${cost.toFixed(2)} used`, grounded ? 'complete' : 'partial');
  return { grounded, banded, unclear, unsupported, count: rows.length };
}
function accessProfileData() {
  return window.BUTLER_TRAVEL_ACCESS?.profiles?.[accessProfileKey()] || null;
}
function accessLevelInfo(level) {
  return window.BUTLER_TRAVEL_ACCESS?.levels?.[level] || window.BUTLER_TRAVEL_ACCESS?.unknown || { label: 'Not assessed', color: '#57736a' };
}
function difficultyLabel(level) { return ({ 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Hard' })[Number(level)] || 'Unclear'; }
for (const feature of window.BUTLER_COUNTRIES?.features || []) {
  const country = feature.properties?.admin;
  if (!country) continue;
  const option = document.createElement('option');
  option.value = country;
  byId('countryOptions').append(option);
}
const allCountryNames = [...new Set((window.BUTLER_COUNTRIES?.features || []).map((feature) => feature.properties?.admin).filter(Boolean))].sort();
for (const id of ['passportContextInput', 'residenceContextInput', 'profilePassportInput', 'profileResidenceInput']) {
  const select = byId(id);
  select.replaceChildren(new Option('Choose a country', ''), ...allCountryNames.map((name) => new Option(name, name)));
}
function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function validIsoDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
let savedCountries = (() => {
  const stored = readJSON(`butler-shortlist:${accessProfileKey()}`, []);
  return Array.isArray(stored) ? [...new Set(stored.filter((name) => allCountryNames.includes(name)))] : [];
})();
const checklistTemplates = {
  Tourism: ['Passport valid for the full trip', 'Check entry route and permitted stay', 'Save official visa or exemption guidance', 'Confirm return or onward travel evidence', 'Keep accommodation and insurance details'],
  'Business visit': ['Passport and business itinerary', 'Confirm business visitor route (no local employment)', 'Invitation or meeting details', 'Check permitted stay and entry conditions', 'Keep accommodation and return travel details'],
  Transit: ['Confirm transit visa requirements', 'Check whether you must pass border control', 'Verify terminal change and layover rules', 'Keep onward ticket and destination documents', 'Check baggage recheck arrangements'],
  Study: ['Confirm student visa or residence permit route', 'Admission letter and course dates', 'Proof of funds and accommodation', 'Health insurance and required certificates', 'Check work limits and arrival steps'],
  Work: ['Confirm work authorization before employment', 'Offer letter and employer documents', 'Check work visa or permit category', 'Prepare qualifications and required certificates', 'Review dependants and arrival requirements'],
  Relocation: ['Confirm long-stay residence route', 'Gather civil and identity records', 'Prepare proof of funds and accommodation', 'Check health coverage and registration steps', 'Review family and customs arrangements'],
  'Family visit': ['Passport and visit dates', 'Invitation and host contact details', 'Confirm visitor entry route and stay limit', 'Keep accommodation and return travel evidence', 'Check travel insurance requirements'],
  'Digital nomad': ['Confirm remote-work visa category exists', 'Prepare remote employment or client evidence', 'Check income threshold and tax conditions', 'Confirm insurance and accommodation', 'Review permitted stay and local registration'],
};
function documentStorageKey() { return `butler-docs:${accessProfileKey()}:${activeCountry}`; }
function savedDocumentState() { try { return JSON.parse(localStorage.getItem(documentStorageKey()) || '{}'); } catch { return {}; } }
function updateApplicationProgress() {
  if (!byId('applicationAutopilot') || byId('applicationAutopilot').hidden) return;
  const tasks = [...byId('applicationTasks').querySelectorAll('[data-autopilot-task]')];
  const documentsReady = tasks.length > 0 && tasks.every((task) => task.checked);
  const formReady = !byId('downloadFilledPdf').hidden;
  const handoffReady = byId('prepareGovernmentEmail').dataset.prepared === 'true';
  const activeStage = handoffReady ? 'handoff' : formReady ? 'handoff' : documentsReady ? 'form' : 'documents';
  byId('autopilotProgress').querySelectorAll('[data-stage]').forEach((stage) => {
    const done = stage.dataset.stage === 'route'
      || (stage.dataset.stage === 'documents' && documentsReady)
      || (stage.dataset.stage === 'form' && formReady)
      || (stage.dataset.stage === 'handoff' && handoffReady);
    stage.classList.toggle('is-done', done);
    stage.classList.toggle('is-active', !done && stage.dataset.stage === activeStage);
  });
}
function openOfficialPdf(url, title) {
  byId('pdfWorkspace').hidden = false;
  byId('pdfWorkspaceTitle').textContent = `GOVERNMENT FORM · ${title}`;
  byId('openOriginalPdf').href = url;
  byId('formAiConsent').checked = false;
  byId('prepareGovernmentEmail').dataset.prepared = '';
  byId('officialPdfViewer').src = `/api/official-file?url=${encodeURIComponent(url)}`;
  byId('downloadFilledPdf').hidden = true;
  byId('autopilotFieldReview').hidden = true;
  byId('autopilotFieldList').replaceChildren();
  byId('prepareApplicationPdf').hidden = false;
  byId('autopilotMissingFields').hidden = true;
  byId('autopilotMissingFields').replaceChildren();
  const previousFilledUrl = byId('officialPdfViewer').dataset.filledUrl;
  if (previousFilledUrl) URL.revokeObjectURL(previousFilledUrl);
  delete byId('officialPdfViewer').dataset.filledUrl;
  byId('formAiStatus').textContent = 'Run AI match, review each answer, then build your review PDF.';
  const matchingCase = (window.BUTLER_OFFICIAL_FORMS || []).find((item) => item.destination === activeCountry && item.passport === travelerProfile.passport && item.residence === travelerProfile.residence && item.residencePermit === travelerProfile.permitType && item.purpose === travelerProfile.purpose && item.duration === travelerProfile.duration && item.files.some((file) => file.url === url));
  const application = matchingCase?.application;
  byId('applicationAutopilot').hidden = !application;
  if (application) {
    byId('autopilotProfile').textContent = `${travelerProfile.passport} passport · ${travelerProfile.residence} resident · ${travelerProfile.purpose} · checked ${application.checkedOn}`;
    byId('autopilotRouteCard').innerHTML = `<div class="autopilot-match-label">BUTLER ROUTE MATCH · SOURCE CHECKED ${escapeHTML(application.checkedOn)}</div><b>Apply for a Japan temporary visitor visa through the Embassy of Japan in Finland.</b><p>India does not appear on Japan’s short-stay visa-exemption list. The Embassy accepts applications from foreign residents of Finland who hold a Finnish residence permit. The JAPAN eVISA direct-application country list does not include Finland.</p><div class="autopilot-authority"><span>OFFICIAL AUTHORITY REFERENCES</span><a href="${safeUrl(application.exemptionUrl)}" target="_blank" rel="noopener noreferrer">Japan visa-exemption list ↗</a><a href="${safeUrl(application.categoryUrl)}" target="_blank" rel="noopener noreferrer">Embassy visa categories ↗</a><a href="${safeUrl(application.processUrl)}" target="_blank" rel="noopener noreferrer">Embassy application process ↗</a><a href="${safeUrl(application.evisaUrl)}" target="_blank" rel="noopener noreferrer">JAPAN eVISA availability ↗</a></div>`;
    byId('officialEmbassyProcess').href = application.processUrl;
    const saved = savedDocumentState();
    const completed = saved.applicationTasks || {};
    byId('applicationTasks').innerHTML = application.steps.map((step) => `<label class="application-task"><input type="checkbox" data-autopilot-task="${escapeHTML(step.id)}" ${completed[step.id] ? 'checked' : ''}><span><b>${escapeHTML(step.text)}</b><a href="${safeUrl(application[step.source])}" target="_blank" rel="noopener noreferrer">Official source ↗</a></span></label>`).join('');
    const updateTaskCount = () => {
      const boxes = [...byId('applicationTasks').querySelectorAll('[data-autopilot-task]')];
      byId('autopilotTaskCount').textContent = `${boxes.filter((box) => box.checked).length} of ${boxes.length} ready`;
    };
    byId('applicationTasks').querySelectorAll('[data-autopilot-task]').forEach((box) => box.addEventListener('change', () => {
      const state = savedDocumentState(); const tasks = { ...(state.applicationTasks || {}), [box.dataset.autopilotTask]: box.checked };
      saveDocState({ ...state, applicationTasks: tasks }); updateTaskCount(); updateApplicationProgress();
    }));
    updateTaskCount();
    updateApplicationProgress();
    const departure = byId('applicationDepartureDate');
    departure.value = saved.applicationDepartureDate || '';
    departure.oninput = () => saveDocState({ ...savedDocumentState(), applicationDepartureDate: departure.value });
    byId('prepareGovernmentEmail').dataset.prepared = '';
    byId('prepareGovernmentEmail').onclick = (event) => {
      if (!departure.value) { event.preventDefault(); toast('Add your departure date for the Embassy email subject.'); departure.focus(); return; }
      const formattedDate = new Date(`${departure.value}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const subject = `Japan visa document pre-check · departure ${formattedDate}`;
      const body = 'Hello,\n\nI would like to request a pre-check of my Japan visa application documents. I will attach my completed application PDF and supporting documents (under 10 MB total) to this email.\n\nPlease let me know the next steps for booking an application appointment.\n\nThank you.';
      byId('prepareGovernmentEmail').href = `mailto:${matchingCase.submission.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      byId('prepareGovernmentEmail').dataset.prepared = 'true'; updateApplicationProgress();
    };
    updateApplicationProgress();
  }
  byId('pdfWorkspace').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderFormLibrary() {
  const state = savedDocumentState();
  const discovered = (window.BUTLER_OFFICIAL_FORMS || []).filter((item) => item.passport === travelerProfile.passport && item.residence === travelerProfile.residence && item.residencePermit === travelerProfile.permitType && item.destination === activeCountry && item.purpose === travelerProfile.purpose && item.duration === travelerProfile.duration);
  byId('liveFormDemo').hidden = discovered.some((item) => item.files.length);
  const seededFiles = discovered.flatMap((item) => item.files.map((file) => ({ ...file, checkedOn: item.checkedOn })));
  const files = [...(Array.isArray(state.officialFiles) ? state.officialFiles : []), ...seededFiles];
  const saved = Array.isArray(state.forms) ? state.forms.filter((form) => form && typeof form.url === 'string' && /^https:\/\//i.test(form.url)) : [];
  const list = [...files.map((file) => ({ ...file, official: true })), ...saved.map((form) => ({ ...form, official: false }))]
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index);
  byId('formLibraryCount').textContent = `${list.length} PDFs`;
  if (discovered.length && byId('formSearchStatus').textContent === 'Search runs only when you click.') byId('formSearchStatus').textContent = `Exa found ${seededFiles.length} official PDF · checked ${new Date(`${discovered[0].checkedOn}T12:00:00`).toLocaleDateString('en-GB')}.`;
  byId('formLibraryList').innerHTML = list.length ? list.map((file) => `<article class="form-library-item"><div><b>${escapeHTML(file.title || 'Government visa application form')}</b><small>${file.official ? `OFFICIAL PDF · EXA CHECKED ${escapeHTML(file.checkedOn || 'date unavailable')}` : 'SAVED LINK · PDF AND AUTHORITY VERIFIED WHEN OPENED'}</small></div><a href="${safeUrl(file.url)}" target="_blank" rel="noopener noreferrer">Original PDF ↗</a><button type="button" data-open-pdf="${escapeHTML(file.url)}" data-pdf-title="${escapeHTML(file.title || 'Official application form')}">${file.url.includes('mofa.go.jp/mofaj/toko/visa/pdfs/application1.pdf') ? 'Open application autopilot' : 'Fill here'}</button></article>`).join('') : '<p class="checklist-source-note">No direct government PDF found yet. Search Exa above; online portals and guidance pages are shown as references, not mislabeled as files.</p>';
  const refs = [...(state.officialFormSources || []), ...discovered.flatMap((item) => item.files.filter((file) => file.sourceUrl).map((file) => ({ title: file.sourceTitle, url: file.sourceUrl })))].filter((source, index, all) => all.findIndex((other) => other.url === source.url) === index);
  byId('formSearchSources').innerHTML = refs.length ? `<div class="checklist-source-heading">OFFICIAL FORM REFERENCES</div>${refs.map((source) => `<a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.url)} ↗</a>`).join('')}` : '';
  byId('formLibraryList').querySelectorAll('[data-open-pdf]').forEach((button) => button.addEventListener('click', () => {
    openOfficialPdf(button.dataset.openPdf, button.dataset.pdfTitle);
  }));
}
byId('openJapanDemo').onclick = () => {
  const demo = (window.BUTLER_OFFICIAL_FORMS || [])[0];
  if (!demo) return;
  setContext(demo.passport, demo.residence, demo.purpose, demo.duration, demo.residencePermit);
  updateDestination(demo.destination);
  byId('formLibraryList').querySelector('[data-open-pdf]')?.click();
  toast('Japan application autopilot is ready.');
};
function initialPreparationSteps(assessment, purpose) {
  if (Array.isArray(assessment?.preparationSteps) && assessment.preparationSteps.length) return assessment.preparationSteps.map((step) => ({ text: step.text, sources: step.sources || [], done: false }));
  if (assessment?.origin === 'home-country') return [{ text: 'No entry visa to arrange for your passport country.', sources: assessment.sources || [], done: false }];
  if (assessment?.detail?.trim()) return assessment.detail.split(/\s+·\s+|\s+•\s+/).map((text) => ({ text: text.trim(), sources: [], done: false })).filter((item) => item.text);
  return (checklistTemplates[purpose] || checklistTemplates.Tourism).map((text) => ({ text, sources: [], done: false }));
}
function renderAccessCard() {
  const assessment = accessAssessment();
  const profileData = accessProfileData();
  const scale = window.BUTLER_TRAVEL_ACCESS?.levels || {};
  const level = assessment ? (scale[assessment.level] || accessLevelInfo('unknown')) : window.BUTLER_TRAVEL_ACCESS?.unknown;
  const tier = Number(assessment?.level) || 0;
  const difficulty = difficultyLabel(tier);
  byId('score').textContent = difficulty;
  byId('readinessLabel').textContent = 'ENTRY DIFFICULTY';
  byId('sampleNotice').innerHTML = assessment
    ? `<span>✳</span> ${escapeHTML(assessment.origin === 'home-country' ? 'RETURN TO PASSPORT COUNTRY · OFFICIAL SOURCE' : assessment.origin === 'exa' ? `EXA EVIDENCE · ${assessment.checkedOn}` : assessment.origin === 'exa-first-scan' ? `FIRST EXA SCAN · ${assessment.checkedOn} · SOURCE-LINKED` : profileData?.description || 'TRAVELER PROFILE · CURATED ACCESS DATA')}`
    : `<span>◷</span> ${escapeHTML(travelerProfile.passport.toUpperCase())} · ${escapeHTML(travelerProfile.residence.toUpperCase())} · NOT ASSESSED`;
  byId('sampleNotice').classList.remove('live');
  byId('visaState').textContent = assessment?.origin === 'home-country' ? 'No visa needed' : tier === 1 ? 'Fewer steps' : tier === 2 ? 'Online step' : tier === 3 ? 'Visa to arrange' : tier === 4 ? 'Full application' : 'Unclear';
  byId('profileState').textContent = `${travelerProfile.passport} · ${travelerProfile.residence}`;
  byId('purposeState').textContent = `${travelerProfile.purpose} · ${travelerProfile.duration}`;
  byId('checkCount').textContent = assessment ? `${assessment.sources?.length || 0} official sources` : 'No data yet';
  byId('checkedState').textContent = assessment ? new Date(`${assessment.checkedOn || window.BUTLER_TRAVEL_ACCESS.checkedOn}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not checked';
  byId('score').style.color = level?.color || '#57736a';
  byId('score').dataset.difficulty = difficulty.toLowerCase();
}

async function initGlobe() {
  const svg = byId('worldGlobe');
  if (!svg || !window.d3?.geoOrthographic) return;
  const d3 = window.d3;
  const center = [139.7, 36.2];
  const baseScale = 320;
  let currentScale = baseScale;
  const projection = d3.geoOrthographic().translate([360, 360]).scale(currentScale).clipAngle(90).precision(.35).rotate([-center[0], -center[1], 0]);
  const geoPath = d3.geoPath(projection);
  const countryLayer = byId('countryLayer');
  const pinLayer = byId('pinLayer');
  const featuresByName = new Map();
  const simplifiedMarkers = new Set();
  const coords = {
    Japan: [139.7, 36.2], 'South Korea': [126.98, 37.56], Thailand: [100.5, 13.75],
    'United Kingdom': [-.12, 51.5], France: [2.35, 48.86], Singapore: [103.82, 1.35],
    Australia: [151.2, -33.87], Canada: [-123.12, 49.28], Helsinki: [24.94, 60.17],
  };
  const pinCodes = { Japan: 'TYO', 'South Korea': 'SEL', Thailand: 'BKK', 'United Kingdom': 'LON', France: 'PAR', Singapore: 'SIN', Australia: 'SYD', Canada: 'YVR' };
  let wasDragged = false;
  let draggedUntil = 0;
  let dragOrigin = null;
  let initialRotation = projection.rotate();
  let currentFeature = null;
  const setPath = (id, data) => { const node = byId(id); if (node) node.setAttribute('d', geoPath(data) || ''); };
  const updateGeometry = () => {
    setPath('graticulePath', d3.geoGraticule10());
    countryLayer.querySelectorAll('.country-shape').forEach((node) => {
      const feature = featuresByName.get(node.dataset.country);
      node.setAttribute('d', geoPath(feature) || '');
    });
    const mapCaption = byId('mapCaption');
    if (mapCaption) mapCaption.textContent = `DESTINATION · ${activeCountry.toUpperCase()}`;
    pinLayer.querySelectorAll('.map-pin').forEach((pin) => {
      pin.classList.toggle('selected', pin.dataset.country === activeCountry);
      const point = coords[pin.dataset.country];
      const rotated = d3.geoRotation(projection.rotate())(point);
      const projected = projection(point);
      const visible = Math.cos(rotated[1] * Math.PI / 180) * Math.cos(rotated[0] * Math.PI / 180) > 0;
      pin.style.display = visible && projected ? '' : 'none';
      if (projected) pin.setAttribute('transform', `translate(${projected[0]},${projected[1]})`);
    });
  };
  refreshGlobeProfile = updateGeometry;
  renderAccessMap = () => {
    const countries = countryLayer.querySelectorAll('.country-shape');
    for (const node of countries) {
      const assessment = accessAssessment(node.dataset.country);
      const level = assessment?.level || 'unknown';
      node.dataset.friction = String(level);
      const visualNote = simplifiedMarkers.has(node.dataset.country) ? ' Simplified island marker at this globe scale.' : '';
      const description = assessment
        ? `${node.dataset.country}: ${accessLevelInfo(level).label}. ${assessment.route}. ${assessment.detail}${visualNote}`
        : `${node.dataset.country}: not assessed for ${travelerProfile.passport} passport and ${travelerProfile.residence} residence.${visualNote}`;
      node.querySelector('title').textContent = description;
      node.setAttribute('aria-label', `Explore ${description}`);
    }
    renderAccessCard();
    refreshHeroGlobe();
  };
  const selectFeature = (name, feature) => {
    currentFeature = feature || featuresByName.get(name) || null;
    countryLayer.querySelectorAll('.country-shape').forEach((node) => node.classList.toggle('selected', node.dataset.country === name));
    const point = coords[name] || (currentFeature && d3.geoCentroid(currentFeature));
    if (point) {
      projection.rotate([-point[0], -point[1], 0]);
      updateGeometry();
    }
    refreshHeroGlobe();
  };
  const animateToFeature = (name, feature, duration = 850) => {
    currentFeature = feature || featuresByName.get(name) || null;
    countryLayer.querySelectorAll('.country-shape').forEach((node) => node.classList.toggle('selected', node.dataset.country === name));
    const point = coords[name] || (currentFeature && d3.geoCentroid(currentFeature));
    if (!point) return selectFeature(name, currentFeature);
    const from = projection.rotate();
    const target = [-point[0], -point[1], 0];
    let longitudeDelta = target[0] - from[0];
    if (longitudeDelta > 180) longitudeDelta -= 360;
    if (longitudeDelta < -180) longitudeDelta += 360;
    target[0] = from[0] + longitudeDelta;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      projection.rotate([
        from[0] + (target[0] - from[0]) * eased,
        from[1] + (target[1] - from[1]) * eased,
        0,
      ]);
      updateGeometry();
      if (progress < 1) requestAnimationFrame(step);
      else refreshHeroGlobe();
    };
    requestAnimationFrame(step);
  };
  setGlobeDestination = (name, animate = false) => animate
    ? animateToFeature(name, featuresByName.get(name))
    : selectFeature(name, featuresByName.get(name));
  try {
    let data = window.BUTLER_COUNTRIES;
    if (!data) {
      const response = await fetch('assets/countries.geojson');
      if (!response.ok) throw new Error('Country outlines could not be loaded.');
      data = await response.json();
    }
    for (const feature of data.features) {
      const name = feature.properties?.admin;
      if (!name) continue;
      featuresByName.set(name, feature);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('country-shape');
      path.dataset.country = name;
      path.setAttribute('d', geoPath(feature) || '');
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `Explore ${name}`);
      path.dataset.friction = 'unknown';
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Explore ${name}`;
      path.append(title);
      path.addEventListener('click', (event) => {
        if (wasDragged || Date.now() < draggedUntil) { event.preventDefault(); return; }
        updateDestination(name);
      });
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateDestination(name); }
      });
      countryLayer.append(path);
    }
    const heroSvg = byId('heroGlobe');
    if (heroSvg) {
      const heroProjection = d3.geoOrthographic().translate([230, 230]).scale(211).clipAngle(90).precision(.4);
      const heroPath = d3.geoPath(heroProjection);
      const heroLayer = byId('heroCountries');
      const heroPins = byId('heroPins');
      const heroGraticule = byId('heroGraticule');
      const homePin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const destinationPin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      homePin.classList.add('hero-pin', 'hero-pin-home');
      destinationPin.classList.add('hero-pin', 'hero-pin-destination');
      homePin.setAttribute('r', '5');
      destinationPin.setAttribute('r', '5');
      heroPins.append(homePin, destinationPin);
      const pointFor = (name) => coords[name] || (featuresByName.get(name) ? d3.geoCentroid(featuresByName.get(name)) : null);
      refreshHeroGlobe = () => {
        const from = pointFor(travelerProfile.residence) || coords.Helsinki;
        const to = pointFor(activeCountry) || coords.Japan;
        const midpoint = d3.geoInterpolate(from, to)(.5);
        heroProjection.rotate([-midpoint[0], -midpoint[1], 0]);
        heroGraticule.setAttribute('d', heroPath(d3.geoGraticule().step([30, 30])()) || '');
        heroLayer.replaceChildren();
        for (const feature of data.features) {
          const country = feature.properties?.admin;
          if (!country) continue;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.classList.add('hero-country');
          path.dataset.friction = String(accessAssessment(country)?.level || 'unknown');
          path.setAttribute('d', heroPath(feature) || '');
          heroLayer.append(path);
        }
        for (const [node, point] of [[homePin, from], [destinationPin, to]]) {
          const projected = heroProjection(point);
          const rotated = d3.geoRotation(heroProjection.rotate())(point);
          node.style.display = projected && Math.cos(rotated[1] * Math.PI / 180) * Math.cos(rotated[0] * Math.PI / 180) > 0 ? '' : 'none';
          if (projected) node.setAttribute('transform', `translate(${projected[0]},${projected[1]})`);
        }
      };
      refreshHeroGlobe();
    }
    for (const [name, point] of Object.entries(coords)) {
      if (name === 'Helsinki' || featuresByName.has(name)) continue;
      const feature = { type: 'Feature', properties: { admin: name }, geometry: d3.geoCircle().center(point).radius(.22)() };
      simplifiedMarkers.add(name);
      featuresByName.set(name, feature);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('country-shape', 'country-marker');
      path.dataset.country = name;
      path.dataset.friction = 'unknown';
      path.setAttribute('d', geoPath(feature) || '');
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `Explore ${name}. Simplified island marker at this globe scale.`);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${name} · simplified island marker at globe scale`;
      path.append(title);
      path.addEventListener('click', (event) => {
        if (wasDragged || Date.now() < draggedUntil) { event.preventDefault(); return; }
        updateDestination(name);
      });
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateDestination(name); }
      });
      countryLayer.append(path);
    }
    byId('countryCount').textContent = `${data.features.length} OUTLINES · ${simplifiedMarkers.size} ISLAND MARKER · DRAG TO ROTATE`;
    renderAccessMap();
    for (const [name, point] of Object.entries(coords)) {
      if (name === 'Helsinki') continue;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('map-pin');
      group.dataset.country = name;
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `Explore ${name}`);
      group.innerHTML = `<circle class="pin-glow" r="11"></circle><circle class="pin-core" r="3.5"></circle><text class="pin-label" x="9" y="-8">${pinCodes[name]}</text>`;
      group.addEventListener('click', () => { if (!wasDragged && Date.now() >= draggedUntil) updateDestination(name); });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateDestination(name); }
      });
      pinLayer.append(group);
    }
    selectFeature(activeCountry, featuresByName.get(activeCountry));
  } catch {
    const message = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    message.setAttribute('x', '360'); message.setAttribute('y', '360'); message.setAttribute('class', 'globe-error');
    message.textContent = 'Open the live Butler app to load the interactive globe.';
    svg.append(message);
  }
  const activePointers = new Map();
  let pinchDistance = 0;
  const pointerDistance = () => {
    const [a, b] = [...activePointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.target?.setPointerCapture) event.target.setPointerCapture(event.pointerId);
    if (activePointers.size > 1) { dragOrigin = null; pinchDistance = pointerDistance(); return; }
    wasDragged = false;
    dragOrigin = { x: event.clientX, y: event.clientY, rotation: projection.rotate() };
  });
  svg.addEventListener('pointermove', (event) => {
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size > 1) {
      const distance = pointerDistance();
      if (pinchDistance && distance) zoom(distance / pinchDistance);
      pinchDistance = distance;
      wasDragged = true;
      return;
    }
    if (!dragOrigin) return;
    const dx = event.clientX - dragOrigin.x;
    const dy = event.clientY - dragOrigin.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) wasDragged = true;
    if (!wasDragged) return;
    projection.rotate([dragOrigin.rotation[0] + dx * .35, Math.max(-85, Math.min(85, dragOrigin.rotation[1] - dy * .35)), 0]);
    updateGeometry();
  });
  const stopDrag = (event) => {
    if (event?.pointerId != null) activePointers.delete(event.pointerId);
    if (wasDragged) draggedUntil = Date.now() + 260;
    dragOrigin = null;
    pinchDistance = 0;
    window.setTimeout(() => { wasDragged = false; }, 280);
  };
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
  byId('resetGlobe').addEventListener('click', () => {
    currentScale = baseScale;
    projection.scale(currentScale);
    projection.rotate(initialRotation);
    selectFeature(activeCountry, featuresByName.get(activeCountry));
  });
  const zoom = (factor) => {
    currentScale = Math.max(170, Math.min(920, currentScale * factor));
    projection.scale(currentScale);
    updateGeometry();
  };
  byId('zoomIn').addEventListener('click', () => zoom(1.16));
  byId('zoomOut').addEventListener('click', () => zoom(1 / 1.16));
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom(Math.exp(-event.deltaY * .0012));
  }, { passive: false });
  svg.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.16); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(1 / 1.16); }
    else if (event.key === '0') { event.preventDefault(); byId('resetGlobe').click(); }
  });
  updateGeometry();
}
initGlobe();

function toast(message) {
  const el = byId('toast');
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 2600);
}
function hasExaConsent() { try { return localStorage.getItem(EXA_CONSENT_KEY) === 'yes'; } catch { return false; } }
function requireExaConsent(destination = activeCountry) {
  if (hasExaConsent()) return true;
  openResearch(destination);
  toast('Review and accept the Exa data-sharing note before a live search.');
  return false;
}
function openDialog(id) { const dialog = byId(id); if (!dialog.open) dialog.showModal(); }
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function safeUrl(value = '') {
  try { const url = new URL(value); return url.protocol === 'https:' ? escapeHTML(url.href) : '#'; }
  catch { return '#'; }
}
function exaCitationLinks(citations = []) {
  const unique = [...new Map(citations.filter((item) => item?.url).map((item) => [item.url, item])).values()].slice(0, 3);
  return unique.length ? `<span class="grounding-links">Source${unique.length === 1 ? '' : 's'}: ${unique.map((item, index) => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title || `#${index + 1}`)} ↗</a>`).join(' · ')}</span>` : '';
}
function setContext(passport, residence, purpose, duration = byId('durationInput').value, permitType = travelerProfile.permitType) {
  const previousAccessKey = accessProfileKey();
  const changed = travelerProfile.passport !== passport || travelerProfile.residence !== residence || travelerProfile.purpose !== purpose || travelerProfile.duration !== duration || travelerProfile.permitType !== permitType;
  travelerProfile = { passport, residence, purpose, duration, permitType };
  if (previousAccessKey !== accessProfileKey()) {
    savedCountries = (() => { const stored = readJSON(`butler-shortlist:${accessProfileKey()}`, []); return Array.isArray(stored) ? [...new Set(stored.filter((name) => allCountryNames.includes(name)))] : []; })();
    renderShortlist();
    syncBookmarkButton();
  }
  for (const [id, value] of [['passportInput', passport], ['residenceInput', residence], ['purposeInput', purpose], ['durationInput', duration]]) byId(id).value = value;
  try { localStorage.setItem('butler-traveler-profile', JSON.stringify({ ...travelerProfile, name: travelerName })); } catch {}
  if (changed) {
    lastResearch = null;
    byId('researchSummary').innerHTML = '<span class="result-orbit">✳</span><span><b>Ready to research</b><small>Run a destination check to start the trail.</small></span><button id="researchAgain">Start research ↗</button>';
    byId('researchAgain').onclick = () => openResearch(activeCountry);
  }
  const flag = flagForCountry(passport);
  byId('passportContextInput').value = passport;
  byId('residenceContextInput').value = residence;
  const standardPermits = [...byId('permitContextInput').options].map((option) => option.value).filter((value) => value !== 'Other');
  const customPermit = !standardPermits.includes(permitType);
  byId('permitContextInput').value = customPermit ? 'Other' : permitType;
  byId('permitContextOther').hidden = !customPermit;
  byId('permitContextOther').value = customPermit ? permitType : '';
  byId('passportContextFlag').textContent = flag;
  byId('residenceContextFlag').textContent = flagForCountry(residence);
  byId('profileDisplayName').textContent = travelerName;
  byId('profileDisplayMeta').textContent = `${passport} passport · ${residence} resident`;
  byId('profileAvatar').textContent = travelerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'B';
  byId('profileNameInput').value = travelerName;
  byId('profilePassportInput').value = passport;
  byId('profileResidenceInput').value = residence;
  const profilePermits = [...byId('profilePermitSelect').options].map((option) => option.value).filter((value) => value !== 'Other');
  const customProfilePermit = !profilePermits.includes(permitType);
  byId('profilePermitSelect').value = customProfilePermit ? 'Other' : permitType;
  byId('profilePermitInput').hidden = !customProfilePermit;
  byId('profilePermitInput').value = customProfilePermit ? permitType : '';
  byId('profilePurpose').value = purpose;
  byId('profileDuration').value = duration;
  byId('purposeSelect').value = purpose;
  byId('purposeInput').value = purpose;
  setWorldResearchStatus('First scan colors apply only to this exact traveler profile; countries with an unresolved or unsupported route remain neutral.');
  renderAccessMap();
  refreshGlobeProfile();

  if (byId('destinationResults')) renderCountryResults(byId('destinationSearch').value);

}
function updateDestination(name, { animate = false } = {}) {
  if (activeCountry !== name && lastResearch?.destination !== name) lastResearch = null;
  activeCountry = name;
  const data = destinations[name] || { flag: '🌍', code: '—', city: name, region: 'Destination' };
  byId('destinationName').textContent = name;
  byId('destinationFlag').textContent = data.flag;
  byId('destinationInput').value = name;
  document.querySelectorAll('.map-pin').forEach((pin) => pin.classList.toggle('selected', pin.dataset.country === name));
  setGlobeDestination(name, animate);
  renderCountryResults(byId('destinationSearch')?.value || '');
  document.querySelectorAll('.destination-chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.country === name));
  syncBookmarkButton();
  if (isPageActive('documents')) openDocuments();
  renderAccessCard();
  if (lastResearch?.destination !== name) {
    byId('researchSummary').innerHTML = '<span class="result-orbit">✳</span><span><b>Ready to research</b><small>Run a destination check to start the trail.</small></span><button id="researchAgain">Start research ↗</button>';
    byId('researchAgain').onclick = () => openResearch(name);
  }
}
function openProfile() {
  byId('profileNameInput').value = travelerName;
  byId('profilePassportInput').value = travelerProfile.passport;
  byId('profileResidenceInput').value = travelerProfile.residence;
  byId('profilePermitInput').value = travelerProfile.permitType;
  byId('profilePurpose').value = travelerProfile.purpose;
  byId('profileDuration').value = travelerProfile.duration;
  byId('profileSaveStatus').textContent = 'Saved in this browser';
  openDialog('profileDialog');
}
function renderCountryResults(query = '') {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = allCountryNames.filter((name) => name.toLocaleLowerCase().includes(normalized)).slice(0, 12);
  byId('destinationSearch').placeholder = `Search ${allCountryNames.length} countries…`;
  const results = byId('destinationResults');
  results.innerHTML = matches.map((name) => `<button type="button" class="country-result ${name === activeCountry ? 'selected' : ''}" data-country="${escapeHTML(name)}"><span>${flagForCountry(name)}</span><b>${escapeHTML(name)}</b><i>${accessLevelInfo(accessAssessment(name)?.level || 'unknown').shortLabel}</i></button>`).join('') || '<p class="country-empty">No matching countries. Try another spelling.</p>';
  results.querySelectorAll('[data-country]').forEach((button) => button.addEventListener('click', () => {
    updateDestination(button.dataset.country);
  }));
}
function persistShortlist() {
  try { localStorage.setItem(`butler-shortlist:${accessProfileKey()}`, JSON.stringify(savedCountries)); } catch {}
  renderShortlist();
}
function syncBookmarkButton() {
  const button = byId('bookmarkButton');
  if (!button) return;
  const saved = savedCountries.includes(activeCountry);
  button.classList.toggle('saved', saved);
  button.textContent = saved ? '♥' : '♡';
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${activeCountry} ${saved ? 'from' : 'to'} shortlist`);
}
function renderShortlist() {
  const panel = byId('shortlistPanel');
  const list = byId('shortlistItems');
  if (!panel || !list) return;
  panel.hidden = !savedCountries.length;
  list.innerHTML = savedCountries.map((name) => `<div class="shortlist-item"><button type="button" class="shortlist-destination" data-open-saved="${escapeHTML(name)}"><span>${flagForCountry(name)}</span><b>${escapeHTML(name)}</b><small>${accessAssessment(name) ? escapeHTML(accessLevelInfo(accessAssessment(name).level).shortLabel) : 'Not assessed'}</small></button><button type="button" data-add-saved="${escapeHTML(name)}" aria-label="Open ${escapeHTML(name)} guidance">Open ↗</button><button type="button" data-remove-saved="${escapeHTML(name)}" aria-label="Remove ${escapeHTML(name)} from shortlist">×</button></div>`).join('');
  list.querySelectorAll('[data-open-saved]').forEach((button) => button.onclick = () => updateDestination(button.dataset.openSaved));
  list.querySelectorAll('[data-remove-saved]').forEach((button) => button.onclick = () => {
    savedCountries = savedCountries.filter((country) => country !== button.dataset.removeSaved);
    persistShortlist(); syncBookmarkButton();
  });
}
function showResearchConsent() {
  const accepted = hasExaConsent();
  byId('exaConsentGate').hidden = accepted;
  byId('researchFields').hidden = !accepted;
  byId('researchActions').hidden = !accepted;
  byId('researchResult').innerHTML = '';
  byId('acceptExaSharing').hidden = accepted;
  byId('cancelExaSharing').hidden = accepted;
}
function previewDemoResearch() {
  byId('researchResult').innerHTML = `<article class="demo-preview"><b>DEMO PREVIEW · NO SEARCH RUN</b><p>This is only a sample of the research layout. No traveler information was shared and no government source was checked.</p><div><span>Route</span><strong>Not assessed</strong></div><div><span>Official sources</span><strong>None retrieved</strong></div><small>Run a live search only if you choose to share your travel context with Exa.</small></article>`;
}
function openResearch(destination = activeCountry) {
  byId('destinationInput').value = destination;
  showResearchConsent();
  openDialog('researchDialog');
}
function renderEvidence() {
  const access = accessAssessment();
  const mode = lastResearch?.mode || (access?.origin?.startsWith('exa') ? 'saved-exa' : access ? 'curated' : 'demo');
  byId('researchMode').textContent = mode === 'live'
    ? `${lastResearch.cached ? 'Cached' : 'Live'} Exa ${lastResearch.focus} research for ${lastResearch.passport} passport · ${lastResearch.residence} resident · ${lastResearch.destination}. Government-domain filter applied.`
    : mode === 'saved-exa'
      ? `${access.origin === 'exa-first-scan' ? 'First Exa scan' : 'Saved Exa entry check'} for ${travelerProfile.passport} passport · ${travelerProfile.residence} resident · ${activeCountry}. Checked ${access.checkedOn}.`
      : mode === 'curated'
        ? `Official entry guidance selected for ${travelerProfile.passport} passport · ${travelerProfile.residence} resident · ${travelerProfile.purpose.toLowerCase()}. Checked ${window.BUTLER_TRAVEL_ACCESS.checkedOn}.`
        : 'A preview of the research trail. Run live research to retrieve current Exa results.';
  const evidenceInsight = byId('evidenceInsight');
  const insight = mode === 'live' ? lastResearch.insights : null;
  evidenceInsight.hidden = !insight || (!insight.summary && !insight.steps?.length);
  evidenceInsight.innerHTML = evidenceInsight.hidden ? '' : `<b>${escapeHTML(({ entry: 'EXA READOUT', documents: 'DOCUMENT CHECKLIST READOUT', advisory: 'OFFICIAL ADVISORY READOUT', question: 'ANSWER' })[lastResearch.focus] || 'EXA READOUT')}</b>${insight.summary ? `<p>${escapeHTML(insight.summary)}</p>${exaCitationLinks(insight.summaryCitations)}` : ''}${insight.steps?.length ? `<ul>${insight.steps.map((step) => `<li>${escapeHTML(step.text)}${exaCitationLinks(step.citations)}</li>`).join('')}</ul>` : ''}`;
  const trace = mode === 'live'
    ? ['Traveler context assembled from the selected profile', `Exa Search · ${lastResearch.focus} · ${lastResearch.destination}`, `${lastResearch.sources.length} official results with highlights`, lastResearch.costDollars?.total != null ? `${lastResearch.cached ? 'Original Exa search cost' : 'Exa reported cost'} · $${Number(lastResearch.costDollars.total).toFixed(6)}` : 'Open original sources and verify requirements']
    : mode === 'saved-exa'
      ? [access.origin === 'exa-first-scan' ? 'First Exa scan matched this exact traveler profile' : 'An Exa search was run for this traveler profile', `Preparation band · ${accessLevelInfo(access.level).label}`, `${access.sources.length} official source${access.sources.length === 1 ? '' : 's'} saved`, 'Run another search to refresh the evidence']
      : mode === 'curated'
        ? ['Traveler profile matched to reviewed entry data', `Entry-friction band · ${accessLevelInfo(access.level).label}`, `${access.sources.length} official source${access.sources.length === 1 ? '' : 's'} selected`, 'Open the authority page and confirm before travel']
        : ['Fictional traveler context loaded', 'Search has not run yet', 'No claims or requirements have been verified', 'Use the research form to start a live Exa search'];
  byId('traceList').innerHTML = trace.map((line, index) => `<div class="trace-item"><i>${index < (mode === 'live' ? 3 : 1) ? '✓' : '◷'}</i><span>${escapeHTML(line)}</span></div>`).join('');
  const sources = mode === 'live' ? lastResearch.sources : mode === 'saved-exa' || mode === 'curated' ? access.sources : lastResearch?.sources || [];
  const sourceLabel = mode === 'live' ? (lastResearch.cached ? 'CACHED EXA RESULT · OFFICIAL DOMAIN' : 'LIVE EXA RESULT · OFFICIAL DOMAIN') : mode === 'saved-exa' ? `SAVED EXA EVIDENCE · CHECKED ${access.checkedOn}` : mode === 'curated' ? `OFFICIAL SOURCE · CHECKED ${window.BUTLER_TRAVEL_ACCESS.checkedOn}` : 'PREVIEW ONLY · NOT RETRIEVED';
  byId('sourcesList').innerHTML = sources.map((source) => `<article class="source-card"><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.url)} ↗</a><p>${escapeHTML(source.text || 'Open the official page to review its current requirements.')}</p><small>${sourceLabel}</small></article>`).join('') || `<div class="evidence-note">${mode === 'live' ? escapeHTML(lastResearch.note || 'No official-domain sources were found. Try a more specific search or check the authority site directly.') : 'No search has run for this destination yet. Start a live Exa search and the original source links will appear here.'}</div>`;
}
function openEvidence() { renderEvidence(); openDialog('evidenceDialog'); }
async function callResearch({ passport, residence, destination, purpose, duration, focus = 'entry', question = '' }) {
  if (FILE_PREVIEW) throw new Error('Open Butler from http://localhost:4173 to use live Exa research.');
  if (!hasExaConsent()) throw new Error('Accept the Exa data-sharing note before starting personalized live research.');
  const response = await fetch(`${API_BASE}/api/research`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passport, residence, residencePermit: travelerProfile.permitType, destination, purpose, duration, focus, question, exaConsent: hasExaConsent() }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Research request failed.');
  return { ...data, passport, residence, destination, purpose, duration, focus, question };
}

document.querySelectorAll('.destination-chip').forEach((item) => {
  const activate = () => updateDestination(item.dataset.country);
  item.addEventListener('click', activate);
});
['passportInput', 'residenceInput', 'purposeInput', 'durationInput', 'purposeSelect'].forEach((id) => byId(id).addEventListener('change', () => {
  const purpose = id === 'purposeSelect' ? byId(id).value : id === 'purposeInput' ? byId(id).value : travelerProfile.purpose;
  setContext(byId('passportInput').value, byId('residenceInput').value, purpose, byId('durationInput').value);
}));
byId('destinationSearch').addEventListener('input', (event) => renderCountryResults(event.target.value));
const countryFromInput = (value) => allCountryNames.find((name) => name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
['passportContextInput', 'residenceContextInput'].forEach((id) => byId(id).addEventListener('change', () => {
  const passport = countryFromInput(byId('passportContextInput').value);
  const residence = countryFromInput(byId('residenceContextInput').value);
  if (!passport || !residence) {
    toast('Choose passport and residence countries from the suggestions.');
    setContext(travelerProfile.passport, travelerProfile.residence, travelerProfile.purpose, travelerProfile.duration, travelerProfile.permitType);
    return;
  }
  setContext(passport, residence, travelerProfile.purpose, travelerProfile.duration, travelerProfile.permitType);
  toast('Traveler context saved. Readiness data has been refreshed.');
}));
byId('permitContextInput').addEventListener('change', () => {
  const other = byId('permitContextInput').value === 'Other';
  byId('permitContextOther').hidden = !other;
  if (other) { byId('permitContextOther').focus(); return; }
  const permitType = byId('permitContextInput').value;
  setContext(travelerProfile.passport, travelerProfile.residence, travelerProfile.purpose, travelerProfile.duration, permitType);
  toast('Residence permit details saved. Readiness data has been refreshed.');
});
byId('permitContextOther').addEventListener('change', () => {
  const permitType = byId('permitContextOther').value.trim() || 'Residence status not specified';
  setContext(travelerProfile.passport, travelerProfile.residence, travelerProfile.purpose, travelerProfile.duration, permitType);
  toast('Residence permit details saved. Readiness data has been refreshed.');
});
byId('acceptExaSharing').addEventListener('click', () => {
  try { localStorage.setItem(EXA_CONSENT_KEY, 'yes'); } catch {}
  showResearchConsent();
  byId('destinationInput').focus();
});
byId('cancelExaSharing').addEventListener('click', () => byId('researchDialog').close());
byId('previewDemo').addEventListener('click', previewDemoResearch);
byId('previewDemoAfterConsent').addEventListener('click', previewDemoResearch);
byId('revokeExaSharing').addEventListener('click', () => {
  try { localStorage.removeItem(EXA_CONSENT_KEY); } catch {}
  showResearchConsent();
  toast('Exa sharing turned off.');
});
byId('profilePermitSelect').addEventListener('change', () => { byId('profilePermitInput').hidden = byId('profilePermitSelect').value !== 'Other'; if (!byId('profilePermitInput').hidden) byId('profilePermitInput').focus(); });
byId('researchFocus').addEventListener('change', () => { byId('researchQuestionWrap').hidden = byId('researchFocus').value !== 'question'; });
renderCountryResults();
byId('researchButton').onclick = () => openResearch();
byId('researchAgain').onclick = () => openResearch();
byId('howButton').onclick = openEvidence;
byId('sourcesButton').onclick = openEvidence;
byId('requirementsButton')?.addEventListener('click', openEvidence);

byId('profileButton').onclick = byId('contextEdit').onclick = openProfile;
byId('saveTravelerProfile').onclick = () => {
  const canonicalCountry = (value) => allCountryNames.find((name) => name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const passport = canonicalCountry(byId('profilePassportInput').value);
  const residence = canonicalCountry(byId('profileResidenceInput').value);
  if (!passport || !residence) { byId('profileSaveStatus').textContent = 'Choose a country from the suggestions.'; toast('Select a passport and residence country from the country list.'); return; }
  travelerName = byId('profileNameInput').value.trim() || 'Traveler';
  const permitType = byId('profilePermitSelect').value === 'Other' ? (byId('profilePermitInput').value.trim() || 'Residence status not specified') : byId('profilePermitSelect').value;
  setContext(passport, residence, byId('profilePurpose').value, byId('profileDuration').value, permitType);
  byId('docName').value = travelerName;
  byId('docNationality').value = passport;
  byId('docResidence').value = residence;
  byId('docPermit').value = permitType;
  saveDocumentProfile();
  updateDocProgress();
  try { localStorage.setItem('butler-traveler-profile', JSON.stringify({ ...travelerProfile, name: travelerName })); } catch {}
  byId('profileSaveStatus').textContent = 'Profile saved in this browser';
  byId('profileDialog').close();
  toast(`Travel map updated for ${passport} passport · ${residence} resident.`);
};
byId('showAllDestinations').onclick = () => { byId('countryBrowser').scrollIntoView({ behavior: 'smooth', block: 'center' }); byId('destinationSearch').focus({ preventScroll: true }); };
byId('bookmarkButton').onclick = (event) => {
  if (savedCountries.includes(activeCountry)) savedCountries = savedCountries.filter((country) => country !== activeCountry);
  else savedCountries.unshift(activeCountry);
  persistShortlist(); syncBookmarkButton();
  toast(savedCountries.includes(activeCountry) ? `${activeCountry} saved to your shortlist.` : `${activeCountry} removed from your shortlist.`);
};
byId('clearShortlist').onclick = () => { savedCountries = []; persistShortlist(); syncBookmarkButton(); toast('Shortlist cleared.'); };

renderShortlist();
setContext(travelerProfile.passport, travelerProfile.residence, travelerProfile.purpose, travelerProfile.duration, travelerProfile.permitType);

byId('docName').value = travelerName;
byId('docNationality').value = travelerProfile.passport;
byId('docResidence').value = travelerProfile.residence;
byId('docPermit').value = travelerProfile.permitType;
restoreDocumentProfile();

async function checkConnection() {
  if (FILE_PREVIEW) {
    byId('connectionLabel').textContent = 'Open live app ↗';
    document.querySelector('.connection').classList.add('demo');
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    const status = await response.json();
    maxTripStops = status.maxTripStops || maxTripStops;
  
    byId('connectionLabel').textContent = status.exaConfigured ? 'Exa ready' : 'Demo mode';
    document.querySelector('.connection').classList.toggle('demo', !status.exaConfigured);
  } catch {
    byId('connectionLabel').textContent = 'Start Butler server';
    document.querySelector('.connection').classList.add('demo');
  }
}
checkConnection();

byId('startResearch').onclick = async () => {
  const passport = byId('passportInput').value;
  const residence = byId('residenceInput').value;
  const destination = byId('destinationInput').value.trim();
  const purpose = byId('purposeInput').value;
  const duration = byId('durationInput').value;
  const focus = byId('researchFocus').value;
  const question = byId('researchQuestion').value.trim();
  if (!destination || destination.length > 80) { toast('Enter a destination under 80 characters.'); return; }
  if (focus === 'question' && !question) { toast('Add a question about travel requirements or government documents.'); byId('researchQuestion').focus(); return; }
  if (focus === 'question' && !/\b(visa|immigration|entry|enter|border|passport|travel document|permit|residence|stay|transit|touris|business visit|study|student|work|employment|relocat|family|digital nomad|application|apply|government form|document|evidence|requirement|eligible|eligibility|embassy|consul|arrival|advisory|travel alert|appointment|fee|invitation|insurance|accommodation|funds|proof|waiver|exempt)\b/i.test(question)) { toast('Butler research is limited to travel requirements, legal preparation, government documents, and official travel advisories.'); byId('researchQuestion').focus(); return; }
  if (!requireExaConsent(destination)) return;
  setContext(passport, residence, purpose, duration);
  const result = byId('researchResult');
  const button = byId('startResearch');
  button.disabled = true;
  result.innerHTML = `<div class="research-loading"><span><i></i> Matching your ${escapeHTML(focus)} research to the traveler profile…</span><span><i></i> Searching Exa for official government pages…</span><span><i></i> Checking source grounding and building the evidence trail…</span></div>`;
  try {
    updateDestination(destination);
    lastResearch = await callResearch({ passport, residence, destination, purpose, duration, focus, question });
    const live = lastResearch.mode === 'live';
    if (live) saveLiveAssessment(lastResearch);
    renderAccessMap();
    renderAccessCard();
    const insights = lastResearch.insights;
    const steps = Array.isArray(insights?.steps) ? insights.steps.slice(0, 6) : [];
    const stepsHtml = steps.length ? `<ul class="exa-steps">${steps.map((step) => `<li>${escapeHTML(step.text)}${exaCitationLinks(step.citations)}</li>`).join('')}</ul>` : '';
    const summaryHtml = insights?.summary ? `<div class="exa-result-head"><span>BUTLER EXPLANATION · SOURCE-LINKED</span></div><p class="exa-summary">${escapeHTML(insights.summary)}</p>${exaCitationLinks(insights.summaryCitations)}` : '';
    const bandLabel = ({ lighter: 'LOWER PREP', some: 'SOME PREP', more: 'MORE PREP', unclear: 'ROUTE UNCLEAR' })[insights?.preparationBand] || 'SOURCE PREVIEW';
    result.innerHTML = `${live ? `<div class="exa-result-head"><span>${escapeHTML(focus === 'question' ? 'ANSWER WITH OFFICIAL SOURCES' : focus === 'advisory' ? 'OFFICIAL TRAVEL ADVISORY' : focus === 'documents' ? 'DOCUMENT PREPARATION' : 'LIVE ENTRY CHECK')}</span>${focus === 'entry' ? `<b>${escapeHTML(bandLabel)}</b>` : ''}</div>${summaryHtml}${stepsHtml}` : '<div class="evidence-note">Exa is not configured on this server, so this result is a source preview only. Connect the server key to run live research.</div>'}<div class="trace-list"><div class="trace-item"><i>${live ? '✓' : '◷'}</i><span>${live ? `${lastResearch.cached ? 'Cached' : 'Live'} Exa ${escapeHTML(focus)} search · ${lastResearch.sources.length} official sources · checked ${new Date().toLocaleDateString('en-GB')}` : 'No live Exa request was made'}</span></div><div class="trace-item"><i>◷</i><span>${escapeHTML(lastResearch.note || 'Review each original official source before relying on the result.')}</span></div></div>${lastResearch.sources.slice(0, 4).map((source) => `<article class="result-source"><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.url)} ↗</a><p>${escapeHTML(source.text || 'Open the official source to review the full guidance.')}</p><small>${live ? `OFFICIAL AUTHORITY · ${lastResearch.cached ? 'CACHED' : 'RETRIEVED'} BY EXA · CHECKED ${new Date().toLocaleDateString('en-GB')}` : 'DEMO · SOURCE PREVIEW'}</small></article>`).join('')}<button class="button-secondary" id="openEvidenceFromResult" type="button" style="width:100%">Open full research trail</button>`;
    byId('researchSummary').innerHTML = `<span class="result-orbit">${live ? '✓' : '✳'}</span><span><b>${live ? `${lastResearch.sources.length} Exa sources found` : 'Demo source preview'}</b><small>${escapeHTML(destination)} · ${escapeHTML(focus)} · evidence linked</small></span><button id="openEvidenceNow">Open evidence ↗</button>`;
    byId('openEvidenceNow').onclick = openEvidence;
    byId('openEvidenceFromResult').onclick = openEvidence;
    setContext(passport, residence, purpose);
    toast('Research finished · source links are ready.');
  } catch (error) {
    result.innerHTML = `<div class="evidence-note">${escapeHTML(error.message)}. Check the server connection, then retry.</div>`;
  } finally { button.disabled = false; }
};

function updateDocProgress() {
  const filled = [...document.querySelectorAll('#page-documents .doc-grid input')].filter((input) => input.value.trim()).length;
  byId('docProgressLabel').textContent = `${filled} of 9 preparation fields filled`;
  byId('docProgressBar').style.width = `${Math.round(filled / 9 * 100)}%`;
}
function documentProfileKey() { return `butler-document-profile:${accessProfileKey()}`; }
function restoreDocumentProfile() {
  const values = readJSON(documentProfileKey(), {});
  const defaults = { docName: travelerName, docNationality: travelerProfile.passport, docResidence: travelerProfile.residence, docPermit: travelerProfile.permitType };
  for (const id of documentProfileFields) byId(id).value = typeof values[id] === 'string' ? values[id] : (defaults[id] || '');
  updateDocProgress();
}
function saveDocumentProfile() {
  const values = Object.fromEntries(documentProfileFields.map((id) => [id, byId(id).value]));
  try { localStorage.setItem(documentProfileKey(), JSON.stringify(values)); } catch {}
}
documentProfileFields.forEach((id) => byId(id).addEventListener('input', () => { saveDocumentProfile(); updateDocProgress(); }));
byId('clearDocProfile').addEventListener('click', () => {
  try { localStorage.removeItem(documentProfileKey()); } catch {}
  restoreDocumentProfile(); toast('Saved document details cleared.');
});
function openDocuments() {
  restoreDocumentProfile();
  const assessment = accessAssessment();
  const purpose = travelerProfile.purpose;
  const state = savedDocumentState();
  const template = checklistTemplates[purpose] || checklistTemplates.Tourism;
  const isUntouchedStarter = Array.isArray(state.items) && state.items.length === template.length && state.items.every((item, index) => item.text === template[index] && !item.done);
  const items = Array.isArray(state.items) && !isUntouchedStarter ? state.items : initialPreparationSteps(assessment, purpose);
  byId('documentTitle').textContent = `${activeCountry} ${purpose.toLowerCase()} pack`;
  byId('documentIntro').textContent = assessment
    ? `${travelerProfile.passport} passport · ${travelerProfile.residence} · ${travelerProfile.permitType} · ${purpose} · ${travelerProfile.duration}.`
    : `${travelerProfile.passport} passport · ${travelerProfile.residence} · ${travelerProfile.permitType} · ${purpose}.`;
  const checklistEvidence = state.exaChecklist;
  const linkedItems = items.filter((item) => item.sources?.length).length;
  byId('docResearchStatus').textContent = checklistEvidence?.checkedOn
    ? `Refreshed ${checklistEvidence.checkedOn} · ${linkedItems} of ${items.length} steps linked to cited sources.`
    : assessment?.preparationSteps?.length
      ? `Prefilled from your previous research · ${linkedItems} steps have direct source links.`
      : assessment?.detail
        ? `Prefilled from your previous research · related official sources are listed below; match each note before acting.`
        : assessment?.origin === 'home-country'
          ? `Based on your saved traveler profile · checked ${assessment.checkedOn}.`
          : `Starter suggestions for your saved profile · not verified against a destination rule.`;
  const references = checklistEvidence?.sources || assessment?.sources || [];
  byId('checklistSources').innerHTML = references.length
    ? `<div class="checklist-source-heading">${linkedItems ? 'CITED OFFICIAL SOURCES · MATCHED LINKS ARE SHOWN WITH EACH STEP' : 'RELATED OFFICIAL SOURCES · NOT MATCHED TO INDIVIDUAL STEPS'}</div>${references.map((source) => `<a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.url)} ↗</a>`).join('')}`
    : '<span class="checklist-source-note">No official source matched yet. Run research before relying on these suggestions.</span>';
  byId('documentChecklist').innerHTML = items.map((item, index) => `<div class="check-item"><input type="checkbox" data-check-item="${index}" aria-label="Mark step complete" ${item.done ? 'checked' : ''}><input class="check-edit" type="text" data-edit-item="${index}" aria-label="Edit checklist step" value="${escapeHTML(item.text)}"><button type="button" data-remove-item="${index}" aria-label="Remove ${escapeHTML(item.text)}">×</button>${item.sources?.length ? `<div class="check-item-sources"><span>OFFICIAL SOURCE</span>${item.sources.map((source) => `<a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || 'Open source')} ↗</a>`).join('')}</div>` : ''}</div>`).join('');
  byId('documentChecklist').querySelectorAll('[data-check-item]').forEach((input) => input.addEventListener('change', () => {
    items[Number(input.dataset.checkItem)].done = input.checked; saveDocState({ ...savedDocumentState(), items });
  }));
  byId('documentChecklist').querySelectorAll('[data-edit-item]').forEach((input) => input.addEventListener('input', () => {
    items[Number(input.dataset.editItem)].text = input.value; saveDocState({ ...savedDocumentState(), items });
  }));
  byId('documentChecklist').querySelectorAll('[data-remove-item]').forEach((button) => button.addEventListener('click', () => {
    items.splice(Number(button.dataset.removeItem), 1); saveDocState({ ...savedDocumentState(), items }); openDocuments();
  }));
  if (!byId('travelBrief').dataset.loadedFor || byId('travelBrief').dataset.loadedFor !== documentStorageKey()) {
    byId('travelBrief').dataset.loadedFor = documentStorageKey();
    byId('travelBrief').value = state.brief || `# ${activeCountry} · ${purpose}\n\nTraveler: ${travelerProfile.passport} passport · resident in ${travelerProfile.residence}\nTrip length: ${travelerProfile.duration}\n\n## Entry route\n${assessment?.route || 'Not assessed — check official guidance'}\n\n## Preparation notes\n- [ ] Confirm requirements with the official authority\n- [ ] Keep source links and copies with your travel documents\n`;
    byId('draftStatus').textContent = state.brief ? 'Draft restored' : 'New local draft';
  }
  byId('pdfWorkspace').hidden = true;
  byId('officialPdfViewer').removeAttribute('src');
  byId('formSearchSources').replaceChildren();
  renderFormLibrary();
  navigateToPage('documents');
}
function saveDocState(state) {
  try { localStorage.setItem(documentStorageKey(), JSON.stringify(state)); } catch {}
}
byId('refreshChecklist').onclick = async () => {
  if (!requireExaConsent()) return;
  const button = byId('refreshChecklist'); const status = byId('docResearchStatus');
  button.disabled = true; status.textContent = 'Exa is checking current official document instructions…';
  try {
    const result = await callResearch({
      passport: travelerProfile.passport, residence: travelerProfile.residence, destination: activeCountry,
      purpose: travelerProfile.purpose, duration: travelerProfile.duration, focus: 'documents',
    });
    if (result.mode !== 'live') throw new Error('Live Exa research is not configured. The starter list is unchanged.');
    const steps = Array.isArray(result.insights?.steps) ? result.insights.steps.filter((step) => typeof step.text === 'string' && step.text.trim()).slice(0, 6) : [];
    if (!steps.length) throw new Error('Exa did not find a source-backed checklist. The current list is unchanged.');
    const old = savedDocumentState();
    const citedSteps = steps.map((step) => {
      const urls = new Set((step.citations || []).map((citation) => citation.url).filter(Boolean));
      return { text: step.text.slice(0, 240), done: false, sources: result.sources.filter((source) => urls.has(source.url)).map(({ title, url }) => ({ title, url })) };
    });
    const exaChecklist = { checkedOn: new Date().toISOString().slice(0, 10), sources: result.sources, costDollars: result.costDollars, cached: Boolean(result.cached) };
    saveDocState({ ...old, items: citedSteps, exaChecklist });
    lastResearch = result;
    byId('researchSummary').innerHTML = `<span class="result-orbit">✓</span><span><b>Exa refreshed your checklist</b><small>${escapeHTML(activeCountry)} · ${result.sources.length} official sources</small></span><button id="openEvidenceNow">Open evidence ↗</button>`;
    byId('openEvidenceNow').onclick = openEvidence;
    openDocuments();
    status.textContent = `Built from ${result.sources.length} official Exa source${result.sources.length === 1 ? '' : 's'} · checked ${exaChecklist.checkedOn}${result.costDollars?.total != null ? ` · ${result.cached ? 'original' : 'reported'} cost $${Number(result.costDollars.total).toFixed(6)}` : ''}. Edit or remove any item.`;
    toast('Checklist refreshed from official sources.');
  } catch (error) { status.textContent = error.message; toast(error.message); }
  finally { button.disabled = false; }
};
byId('travelBrief').addEventListener('input', () => {
  const state = savedDocumentState(); saveDocState({ ...state, brief: byId('travelBrief').value });
  byId('draftStatus').textContent = 'Saved on this device';
});
byId('addChecklistItem').onclick = () => {
  const text = byId('newChecklistItem').value.trim(); if (!text) return;
  const state = savedDocumentState();
  const items = Array.isArray(state.items) ? state.items : initialPreparationSteps(accessAssessment(), travelerProfile.purpose);
  items.push({ text, done: false }); saveDocState({ ...savedDocumentState(), items }); byId('newChecklistItem').value = ''; openDocuments();
};
byId('newChecklistItem').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); byId('addChecklistItem').click(); } });
byId('findOfficialPdf').onclick = async () => {
  if (!requireExaConsent()) return;
  const button = byId('findOfficialPdf'); const status = byId('formSearchStatus');
  button.disabled = true; status.textContent = 'Searching official government sites for direct application PDFs…';
  try {
    const result = await callResearch({ passport: travelerProfile.passport, residence: travelerProfile.residence, destination: activeCountry, purpose: travelerProfile.purpose, duration: travelerProfile.duration, focus: 'forms' });
    if (result.mode !== 'live') throw new Error('Live Exa search is not configured. No sample PDF is being shown.');
    const old = savedDocumentState();
    const files = Array.isArray(result.files) ? result.files : [];
    const mergedFiles = [...files, ...(old.officialFiles || [])].filter((file, index, all) => all.findIndex((other) => other.url === file.url) === index).slice(0, 12);
    saveDocState({ ...old, officialFiles: mergedFiles, formSearchCheckedOn: new Date().toISOString().slice(0, 10) });
    renderFormLibrary();
    byId('formSearchSources').innerHTML = result.sources?.length ? `<div class="checklist-source-heading">OFFICIAL PAGES EXA CHECKED</div>${result.sources.map((source) => `<a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title || source.url)} ↗</a>`).join('')}` : '';
    status.textContent = files.length ? `${files.length} direct government PDF${files.length === 1 ? '' : 's'} found · checked ${new Date().toLocaleDateString('en-GB')}.` : (result.note || 'No direct PDF found. The authority may use an online portal.');
    lastResearch = result; toast(files.length ? 'Official application PDF found.' : 'No direct application PDF found.');
  } catch (error) { status.textContent = error.message; toast(error.message); }
  finally { button.disabled = false; }
};
byId('addOfficialForm').onclick = () => {
  const title = byId('newFormTitle').value.trim(); const url = byId('newFormUrl').value.trim();
  try { if (!title || new URL(url).protocol !== 'https:') throw new Error(); } catch { toast('Add a file name and a valid HTTPS link.'); return; }
  const state = savedDocumentState(); const forms = Array.isArray(state.forms) ? state.forms : [];
  if (!forms.some((form) => form.url === url)) forms.push({ title, url });
  saveDocState({ ...state, forms }); byId('newFormTitle').value = ''; byId('newFormUrl').value = ''; renderFormLibrary(); toast('Saved. Butler will check that it is an official PDF when opened.');
};
byId('autofillOfficialPdf').onclick = async () => {
  const status = byId('formAiStatus');
  if (!byId('formAiConsent').checked) { status.textContent = 'Tick the sharing option first so you can review exactly what is sent.'; return; }
  if (!requireExaConsent()) return;
  const button = byId('autofillOfficialPdf'); button.disabled = true;
  status.textContent = 'Exa is matching saved profile details to the official PDF fields…';
  try {
    const profile = {
      fullName: byId('docName').value,
      nationality: byId('docNationality').value,
      passportExpiry: byId('docPassportExpiry').value,
      residence: byId('docResidence').value,
      permitType: byId('docPermit').value,
      permitExpiry: byId('docPermitExpiry').value,
      purposeNotes: `${travelerProfile.purpose} · ${travelerProfile.duration}${byId('docDates').value.trim() ? ` · ${byId('docDates').value.trim()}` : ''}`,
      accommodation: byId('docStay').value,
      purpose: travelerProfile.purpose,
      duration: travelerProfile.duration,
      departureDate: byId('applicationAutopilot').hidden ? '' : byId('applicationDepartureDate').value,
    };
    const response = await fetch('/api/pdf-autofill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: byId('openOriginalPdf').href, profile, exaConsent: hasExaConsent(), formAiConsent: true }) });
    if (!response.ok) {
      let message = 'Could not prepare this form.';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    const result = await response.json();
    const fields = Array.isArray(result.fields) ? result.fields : [];
    byId('autopilotFieldList').innerHTML = fields.length ? fields.map((field) => {
      const options = Array.isArray(field.options) ? field.options : [];
      const control = field.kind === 'choice'
        ? `<select data-form-field="${escapeHTML(field.name)}"><option value="">Choose an answer</option>${options.map((option) => `<option value="${escapeHTML(option)}" ${option === field.answer ? 'selected' : ''}>${escapeHTML(option)}</option>`).join('')}</select>`
        : `<input type="text" data-form-field="${escapeHTML(field.name)}" value="${escapeHTML(field.answer || '')}" autocomplete="off">`;
      return `<label class="autopilot-answer-field"><span>${escapeHTML(field.label || 'Application field')}${field.required ? ' · REQUIRED' : ''}${field.suggested ? ' · AI MATCH' : ''}</span>${control}</label>`;
    }).join('') : '<p class="checklist-source-note">No profile values matched this form. Use the official PDF fields below to complete it manually.</p>';
    byId('autopilotFieldReview').hidden = false;
    byId('autopilotMissingFields').hidden = true;
    byId('autopilotMissingFields').replaceChildren();
    byId('prepareApplicationPdf').hidden = !fields.length;
    status.textContent = `${result.suggestions || 0} profile match${result.suggestions === 1 ? '' : 'es'} found · ${result.requiredRemaining || 0} required field${result.requiredRemaining === 1 ? '' : 's'} need your answers. Review the values below before building the PDF.`;
    byId('pdfPrepareStatus').textContent = 'Nothing is submitted. Answers stay in this browser unless you request a PDF build.';
    toast('Review the matched answers and missing fields.');
  } catch (error) { status.textContent = error.message; toast(error.message); }
  finally { button.disabled = false; }
};
byId('prepareApplicationPdf').onclick = async () => {
  const button = byId('prepareApplicationPdf'); const status = byId('pdfPrepareStatus');
  const values = Object.fromEntries([...byId('autopilotFieldList').querySelectorAll('[data-form-field]')].map((control) => [control.dataset.formField, control.value]));
  button.disabled = true; status.textContent = 'Building your review copy from the official PDF…';
  try {
    const response = await fetch('/api/pdf-prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: byId('openOriginalPdf').href, values }) });
    if (!response.ok) {
      let message = 'Could not build the review PDF.';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const oldUrl = byId('officialPdfViewer').dataset.filledUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const filledUrl = URL.createObjectURL(blob);
    byId('officialPdfViewer').dataset.filledUrl = filledUrl;
    byId('officialPdfViewer').src = filledUrl;
    const download = byId('downloadFilledPdf'); download.href = filledUrl; download.hidden = false;
    const count = Number(response.headers.get('X-Prepared-Field-Count') || 0);
    let missing = [];
    try { missing = JSON.parse(response.headers.get('X-Missing-Required-Fields') || '[]'); } catch {}
    const missingPanel = byId('autopilotMissingFields');
    missingPanel.hidden = !missing.length;
    missingPanel.innerHTML = missing.length ? `<b>Still marked required by the PDF</b><ul>${missing.map((field) => `<li>${escapeHTML(field.label)}</li>`).join('')}</ul><small>Complete these in the PDF viewer, or add them above and rebuild.</small>` : '';
    status.textContent = `${count} answer${count === 1 ? '' : 's'} added. Review the PDF and download your copy.`;
    updateApplicationProgress();
    toast('Review PDF is ready.');
  } catch (error) { status.textContent = error.message; toast(error.message); }
  finally { button.disabled = false; }
};
document.querySelectorAll('[data-insert]').forEach((button) => button.addEventListener('click', () => {
  const prefix = ({ heading: '\n## ', bullet: '\n- ', check: '\n- [ ] ' })[button.dataset.insert];
  const editor = byId('travelBrief'); const start = editor.selectionStart; const end = editor.selectionEnd;
  editor.setRangeText(prefix, start, end, 'end'); editor.focus(); editor.dispatchEvent(new Event('input', { bubbles: true }));
}));
byId('downloadBrief').onclick = () => {
  const blobUrl = URL.createObjectURL(new Blob([byId('travelBrief').value], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = blobUrl; link.download = `butler-${activeCountry.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-travel-brief.md`; link.click(); URL.revokeObjectURL(blobUrl);
};
document.querySelectorAll('#page-documents input').forEach((input) => input.addEventListener('input', updateDocProgress));
updateDocProgress();
byId('downloadProfile').onclick = () => {
  const profile = { demo: true, name: byId('docName').value, passportCountry: byId('docNationality').value, passportExpiry: byId('docPassportExpiry').value, residence: byId('docResidence').value, residencePermit: byId('docPermit').value, residencePermitExpiry: byId('docPermitExpiry').value, travelDates: byId('docDates').value, accommodation: byId('docStay').value, emergencyContact: byId('docEmergency').value };
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'butler-demo-travel-profile.json'; link.click(); URL.revokeObjectURL(url);
};
byId('printBrief').onclick = () => window.print();

byId('researchDialog').addEventListener('close', () => { if (lastResearch) renderEvidence(); });
if (isPageActive('documents')) openDocuments();

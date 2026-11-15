/*
 * Butler's map palette is a traveler-specific entry-friction guide, not a
 * likelihood-of-entry score. Add an assessment set under the normalized
 * passport|residence|purpose key for each new traveler profile.
 */
window.BUTLER_TRAVEL_ACCESS = {
  checkedOn: '2026-11-14',
  levels: {
    1: { label: 'Easy', shortLabel: 'Easy', color: '#65b9a8' },
    2: { label: 'Medium', shortLabel: 'Medium', color: '#7eafd2' },
    3: { label: 'Hard', shortLabel: 'Hard', color: '#a696ce' },
    4: { label: 'Hard', shortLabel: 'Hard', color: '#d4a36a' },
  },
  unknown: { label: 'Not assessed', shortLabel: 'Not assessed', color: '#57736a' },
  profiles: {
    'india|finland|tourism': {
      description: 'Indian passport · Finland resident · tourism · short stay',
      countries: {
        France: {
          level: 1,
          maxStayDays: 90,
          route: 'Schengen residence permit',
          detail: 'A valid Finnish residence permit allows short stays in other Schengen countries, generally up to 90 days in any 180-day period. Carry your passport and permit.',
          sources: [{ title: 'European Commission · Schengen residence permits', url: 'https://home-affairs.ec.europa.eu/document/download/d87524c3-693b-4206-b57d-3c0903a9f984_en?filename=FAQs_en_0.pdf' }],
        },
        Thailand: {
          level: 1,
          maxStayDays: 30,
          route: 'Tourist visa exemption · up to 30 days',
          detail: 'Indian ordinary passport holders can use Thailand’s tourism exemption for up to 30 days. Conditions include proof of onward travel, funds, and the digital arrival card.',
          sources: [{ title: 'Royal Thai Embassy, Helsinki · 30-day exemption', url: 'https://helsinki.thaiembassy.org/en/publicservice/updated-tourist-visa-exemption-scheme-30-days-effective-15-september-2' }],
        },
        Japan: {
          level: 3,
          maxStayDays: 90,
          route: 'Short-stay visa application',
          detail: 'A visa is needed for this passport. As a Finland resident with a residence permit, the traveler can apply through Japan’s embassy in Finland; typical processing is about five working days, but may take longer.',
          sources: [
            { title: 'Japan MOFA · Short-stay visa procedures', url: 'https://www.mofa.go.jp/j_info/visit/visa/short/other_visa.html' },
            { title: 'Embassy of Japan in Finland · How to apply', url: 'https://www.fi.emb-japan.go.jp/itpr_fi/11_000001_00365.html' },
          ],
        },
        'South Korea': {
          level: 3,
          route: 'Short-stay visa application',
          detail: 'The ordinary-passport visa exemption does not cover India. Finland-resident applicants use the Korean Embassy’s short-stay application route; confirm the right category and bring the Finnish residence permit card.',
          sources: [
            { title: 'Embassy of Korea in Finland · Short-stay visa requirements', url: 'https://overseas.mofa.go.kr/fi-en/brd/m_20979/view.do?page=1&seq=1' },
            { title: 'Korean visa-free entry · passport types by nationality', url: 'https://overseas.mofa.go.kr/at-en/wpge/m_8372/contents.do' },
          ],
        },
        Singapore: {
          level: 3,
          route: 'Entry visa required before travel',
          detail: 'Singapore lists Indian travel documents as visa-required for short-term visits. The separate visa-free transit facility only applies when its transit conditions are met.',
          sources: [{ title: 'Singapore ICA · Visa requirements', url: 'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements' }],
        },
        'United Kingdom': {
          level: 4,
          route: 'Visitor visa before travel',
          detail: 'Indian nationals are on the UK visa-national list and need visitor entry clearance before travel, subject to any specific exception that applies to the traveler.',
          sources: [{ title: 'UK Home Office · Visitor visa-national list', url: 'https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-visitor-visa-national-list' }],
        },
        Australia: {
          level: 4,
          route: 'Visitor visa application',
          detail: 'Tourism commonly uses Australia’s Visitor visa (subclass 600) application route. Confirm the correct visa option for the traveler before applying.',
          sources: [{ title: 'Australian Department of Home Affairs · Visitor visa 600', url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas' }],
        },
        Canada: {
          level: 4,
          route: 'Visitor visa + biometrics in most cases',
          detail: 'India is on Canada’s visa-required list. Visitor-visa applicants usually need to provide biometrics; a Finnish residence permit does not replace the Canadian entry document.',
          sources: [{ title: 'Canada IRCC · Entry requirements by country', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html' }],
        },
      },
    },
  },
};

const longStayAuthorities = {
  France: { title: 'France · official long-stay visa portal', url: 'https://france-visas.gouv.fr/en/web/france-visas/long-stay-visa' },
  Thailand: { title: 'Thailand · official e-Visa portal', url: 'https://www.thaievisa.go.th/' },
  Japan: { title: 'Japan MOFA · work or long-stay visas', url: 'https://www.mofa.go.jp/j_info/visit/visa/long/' },
  'South Korea': { title: 'Korea · official visa portal', url: 'https://www.visa.go.kr/openPage.do?MENU_ID=10101' },
  Singapore: { title: 'Singapore ICA · student pass', url: 'https://www.ica.gov.sg/reside/STP/apply' },
  'United Kingdom': { title: 'UK · visas and immigration', url: 'https://www.gov.uk/browse/visas-immigration' },
  Australia: { title: 'Australia · visa options', url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-finder' },
  Canada: { title: 'Canada IRCC · work and study permits', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit.html' },
};
for (const purpose of ['Study', 'Work', 'Relocation']) {
  const key = `india|finland|${purpose.toLowerCase()}`;
  window.BUTLER_TRAVEL_ACCESS.profiles[key] = {
    description: `Indian passport · Finland resident · ${purpose.toLowerCase()} · long stay`,
    countries: Object.fromEntries(Object.entries(longStayAuthorities).map(([country, source]) => [country, {
      level: 4,
      route: purpose === 'Study' ? 'Student visa / residence permit to arrange' : purpose === 'Work' ? 'Work authorization to arrange' : 'Long-stay residence route to arrange',
      detail: purpose === 'Work'
        ? 'Plan for destination-specific work authorization before taking employment. Visitor entry permission does not by itself authorize work. Check the exact category, sponsor, and eligibility with the official authority.'
        : purpose === 'Study'
          ? 'Plan for the destination’s student visa or residence-permit route. Requirements vary by course length and institution; confirm admission, funds, insurance, and arrival steps with the official authority.'
          : 'Relocation normally requires the destination’s long-stay visa or residence route. The category and documents depend on why you are moving; confirm eligibility, funds, insurance, and registration steps with the official authority.',
      sources: [source],
    }]))
  };
}

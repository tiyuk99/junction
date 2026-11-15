window.BUTLER_OFFICIAL_FORMS = [
  {
    passport: 'India', residence: 'Finland', residencePermit: 'Student residence permit',
    destination: 'Japan', purpose: 'Tourism', duration: '14 days',
    checkedOn: '2026-11-14',
    submission: {
      email: 'visa-apply@hk.mofa.go.jp',
      sourceTitle: 'Embassy of Japan in Finland · Consular information',
      sourceUrl: 'https://www.fi.emb-japan.go.jp/itpr_fi/consular.html',
      checkedOn: '2026-11-15',
    },
    application: {
      checkedOn: '2026-11-15',
      categoryUrl: 'https://www.fi.emb-japan.go.jp/itpr_fi/visas.html',
      sightseeingUrl: 'https://www.fi.emb-japan.go.jp/itpr_fi/11_000001_00393.html',
      processUrl: 'https://www.fi.emb-japan.go.jp/itpr_fi/11_000001_00365.html',
      exemptionUrl: 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html',
      evisaUrl: 'https://www.mofa.go.jp/j_info/visit/visa/visaonline.html',
      steps: [
        { id: 'passport', text: 'Valid passport with at least two blank visa pages; print the bio-data page on A4.', source: 'sightseeingUrl' },
        { id: 'residence', text: 'Bring your Finland residence permit and an A4 copy of both sides (except EU nationals).', source: 'sightseeingUrl' },
        { id: 'application-photo', text: 'Complete and print the application; sign it by hand. Photo: 4.5 × 3.5 cm, taken within 6 months, on photo paper.', source: 'sightseeingUrl' },
        { id: 'funds', text: 'Prepare recent proof of funds covering 3 months. Documents must be in English or Japanese, or translated into English.', source: 'sightseeingUrl' },
        { id: 'travel-proof', text: 'Gather flight reservation or planned schedule, hotel confirmation, and the Embassy’s daily travel itinerary document.', source: 'sightseeingUrl' },
        { id: 'precheck', text: 'Email the documents for pre-check. Include departure date in the subject; attachments must be under 10 MB. The Embassy then offers an appointment.', source: 'processUrl' },
        { id: 'appointment', text: 'At your appointment, bring physical documents printed on A4. Do not staple them. Required documents must be valid and issued within 3 months.', source: 'processUrl' },
      ],
    },
    files: [{
      title: 'Japan visa application form (English)',
      url: 'https://www.mofa.go.jp/mofaj/toko/visa/pdfs/application1.pdf',
      sourceTitle: 'Visa application documents · Ministry of Foreign Affairs of Japan',
      sourceUrl: 'https://www.mofa.go.jp/j_info/visit/visa/short/other_visa.html',
    }],
  },
];

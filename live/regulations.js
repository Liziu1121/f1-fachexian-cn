(() => {
  'use strict';

  const filter = document.getElementById('ruleFilter');
  const tabs = document.getElementById('ruleTabs');
  const results = document.getElementById('ruleList');
  const english = () => window.F1_LOCALE.english();
  const sections = {
    A: ['总则', 'General provisions'], B: ['竞赛规则', 'Sporting regulations'],
    C: ['技术规则', 'Technical regulations'], D: ['车队财务规则', 'Team financial regulations'],
    E: ['动力单元制造商财务规则', 'Power unit financial regulations'], F: ['运营规则', 'Operational regulations'],
  };
  const aliases = {
    安全车: 'safety car', 虚拟安全车: 'virtual safety car', 轮胎: 'tyres', 积分: 'points',
    处罚: 'penalty', 排位赛: 'qualifying', 冲刺赛: 'sprint', 红旗: 'red flag',
    维修区: 'pit lane', 进站: 'pit stop', 预算帽: 'cost cap', 预算上限: 'cost cap',
    动力单元: 'power unit', 燃油: 'fuel', 车重: 'mass', 超车: 'overtaking',
    测试: 'testing', 风洞: 'wind tunnel', 发车: 'starting procedure', 车手: 'driver',
  };
  let section = '', data, loading, visibleLimit = 60;
  const label = (zh, en) => english() ? en : zh;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function hash(word) {
    let result = 2166136261;
    for (const character of word) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return (result >>> 0).toString(36);
  }
  function pageTerms(query) {
    for (const [key, value] of Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)) {
      query = query.replaceAll(key, ' ' + value + ' ');
    }
    if (/\p{Script=Han}/u.test(query)) return null;
    return (query.match(/[a-z0-9]+(?:\.[0-9]+)*/g) || []).map(hash);
  }
  const translations = {
    'A2.2.1': ['How are Grand Prix points awarded?', 'Under the full points scale, the top ten receive 25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 point respectively. If a race ends early, the distance completed by the leader determines the scale. In 2026 there is no extra point for fastest lap.'],
    'A2.2.2': ['How are Sprint points awarded?', 'When points can be awarded, the first eight finishers receive 8, 7, 6, 5, 4, 3, 2 and 1 point respectively. Sprint points count toward both championships.'],
    'A2.1.4': ['How are the championships decided?', 'The drivers’ championship is decided by season points. The constructors’ championship counts results from both cars. The FIA regulations specify how ties are settled.'],
    'B2.1': ['How do standard and Sprint weekends differ?', 'A standard weekend has three practice sessions, qualifying and a race. A Sprint weekend generally has one practice session, Sprint Qualifying, the Sprint, Grand Prix qualifying and the Grand Prix. Sprint Qualifying sets the Sprint grid, while Grand Prix qualifying and subsequent grid penalties determine the race grid.'],
    'B2.4': ['How does Grand Prix qualifying work?', 'There are three stages: Q1, Q2 and Q3. With 22 cars taking part, six are eliminated in each of the first two stages, leaving ten to contest pole. Grid penalties and pit-lane starts can also affect the starting order.'],
    'B2.2': ['How long are Sprint Qualifying and the Sprint?', 'The three Sprint Qualifying stages last 12, 10 and 8 minutes. The Sprint is run over a set number of laps, typically about 100 kilometres.'],
    'B5.12': ['What is the difference between a Safety Car and a Virtual Safety Car?', 'Behind the Safety Car, drivers slow down and form a queue. Under the Virtual Safety Car, drivers must meet the minimum time set by the FIA in designated sections. Overtaking is generally restricted in both cases, with specific exceptions.'],
    'B5.14': ['What happens after a red flag?', 'The red flag suspends the session. Drivers slow down and stop where directed. Officials announce how the session will resume when conditions permit. A Grand Prix may restart with a rolling or standing start.'],
    'B1.8': ['What happens when a driver leaves the track?', 'Drivers must stay within the track limits. They must rejoin safely and may not retain a lasting advantage. Depending on the circumstances, stewards may delete a lap, impose a time or grid penalty, or take other action.'],
    'B6.3.6': ['Why do drivers change tyres in a dry race?', 'Drivers who do not use intermediate or wet tyres generally must use at least two different dry compounds, including a compound designated for the race. A specific event can have additional requirements.'],
    'B3.5': ['Can teams make major changes under parc fermé?', 'Only checks, servicing and replacements permitted by the regulations are allowed. An unauthorised setup or component change can affect how the car starts.'],
  };

  const reader = node('dialog', '', 'regulation-reader');
  const readerTitle = node('h2');
  readerTitle.id = 'regulationReaderTitle';
  reader.setAttribute('aria-labelledby', readerTitle.id);
  const notice = node('p', '', 'sub');
  const close = node('button', '', 'action');
  close.type = 'button';
  close.addEventListener('click', () => reader.close());
  const picker = node('input');
  picker.type = 'file';
  picker.accept = 'application/pdf,.pdf';
  picker.id = 'regulationReaderFile';
  const pickerLabel = node('label');
  pickerLabel.htmlFor = picker.id;
  const fileLanguage = node('select');
  const fileLanguageLabel = node('label');
  fileLanguageLabel.htmlFor = fileLanguage.id = 'regulationFileLanguage';
  fileLanguage.append(new Option('English', 'en'), new Option('简体中文', 'zh'));
  const frame = node('iframe');
  frame.hidden = true;
  const translate = node('button', '', 'action');
  translate.type = 'button';
  translate.hidden = true;
  const previousPage = node('button', '', 'action');
  const followingPage = node('button', '', 'action');
  const pageControls = node('div', '', 'regulation-reader-tools');
  previousPage.type = followingPage.type = 'button';
  pageControls.append(previousPage, followingPage);
  pageControls.hidden = true;
  const translatedPage = node('div', '', 'regulation-translated');
  translatedPage.hidden = true;
  const tools = node('div', '', 'regulation-reader-tools');
  tools.append(close, fileLanguageLabel, fileLanguage, pickerLabel, picker, translate);
  reader.append(readerTitle, tools, notice, frame, pageControls, translatedPage);
  results.after(reader);

  const files = new Map();
  const translators = new Map();
  let selected, translationRequest, pdfModule;
  const siteLanguage = () => english() ? 'en' : 'zh';
  const fileKey = language => selected && [language, selected.document.url].join(':');
  function drawReader() {
    if (!selected || !reader.open) return;
    const { document, page } = selected;
    const language = siteLanguage();
    const other = language === 'en' ? 'zh' : 'en';
    const name = document.section + ' · ' + sections[document.section][english() ? 1 : 0];
    readerTitle.textContent = name + (page ? label(` · 第 ${page} 页`, ` · Page ${page}`) : '');
    close.textContent = label('关闭', 'Close');
    fileLanguageLabel.textContent = label('PDF 原文语言', 'PDF source language');
    pickerLabel.textContent = label('选择本地 PDF', 'Choose a local PDF');
    translate.textContent = label('翻译为中文', 'Translate to English');
    previousPage.textContent = label('上一页', 'Previous page');
    followingPage.textContent = label('下一页', 'Next page');
    frame.title = readerTitle.textContent;
    const file = files.get(fileKey(language));
    const foreign = files.get(fileKey(other));
    const source = file ? file.url + '#page=' + (page || 1) : '';
    frame.hidden = !source;
    if (source && frame.getAttribute('src') !== source) frame.src = source;
    if (!source) frame.removeAttribute('src');
    if (file || !foreign) {
      pageControls.hidden = true;
      translatedPage.hidden = true;
    }
    translate.hidden = !!file || !foreign || !globalThis.Translator;
    notice.textContent = source ? '' : !foreign ? label(
      '选择这一卷的完整 PDF。文件只在当前浏览器内打开。',
      'Choose the complete PDF for this volume. The file opens only in this browser.') : !globalThis.Translator ? label(
      '当前浏览器不支持本地翻译，请选择中文 PDF。',
      'Local translation is unavailable in this browser. Choose an English PDF.') : label(
      '可在本机逐页翻译文本。图表仍以原 PDF 为准，译文仅供参考。',
      'Translate text page by page on this device. Use the original PDF for figures. Translations are for reference.');
  }
  picker.addEventListener('change', () => {
    const file = picker.files[0];
    if (!file || !/\.pdf$/i.test(file.name) || !selected) return;
    const key = fileKey(fileLanguage.value);
    const old = files.get(key);
    if (old) {
      URL.revokeObjectURL(old.url);
      old.pdf?.destroy();
    }
    files.set(key, { file, url: URL.createObjectURL(new Blob([file], { type: 'application/pdf' })), translations: new Map() });
    picker.value = '';
    translationRequest = null;
    pageControls.hidden = translatedPage.hidden = true;
    drawReader();
  });

  async function translatePage() {
    const target = siteLanguage();
    const source = target === 'zh' ? 'en' : 'zh';
    const file = files.get(fileKey(source));
    if (!file || !selected || !globalThis.Translator) return;
    const request = {};
    translationRequest = request;
    const current = selected;
    translate.disabled = previousPage.disabled = followingPage.disabled = true;
    translatedPage.hidden = true;
    notice.textContent = label('正在准备翻译…', 'Preparing translation…');
    try {
      const pair = source + ':' + target;
      if (!translators.has(pair)) {
        const translator = Translator.create({ sourceLanguage: source, targetLanguage: target });
        translators.set(pair, translator);
        translator.catch(() => translators.delete(pair));
      }
      const translator = await translators.get(pair);
      pdfModule ??= import('./pdf-reader/pdf.mjs').catch(error => { pdfModule = undefined; throw error; });
      const pdfLibrary = await pdfModule;
      pdfLibrary.GlobalWorkerOptions.workerSrc = new URL('./pdf-reader/pdf.worker.mjs', location.href).href;
      file.pdf ??= await pdfLibrary.getDocument({ data: new Uint8Array(await file.file.arrayBuffer()), isEvalSupported: false }).promise;
      const page = Math.min(current.page || 1, file.pdf.numPages);
      if (!file.translations.has(page)) {
        const pdfPage = await file.pdf.getPage(page);
        const content = await pdfPage.getTextContent();
        const text = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
        if (!text) throw new Error('No text layer');
        const blocks = text.match(/[\s\S]{1,1500}(?:\s|$)|[\s\S]{1,1500}/g) || [];
        const translated = [];
        for (const block of blocks) translated.push(await translator.translate(block));
        file.translations.set(page, translated.join('\n'));
      }
      if (translationRequest !== request || !reader.open || target !== siteLanguage()) return;
      translatedPage.textContent = file.translations.get(page);
      translatedPage.hidden = pageControls.hidden = false;
      selected.page = page;
      drawReader();
      previousPage.disabled = page === 1;
      followingPage.disabled = page === file.pdf.numPages;
      reader.scrollTop = 0;
    } catch {
      if (translationRequest === request) {
        notice.textContent = label('此页无法翻译。请核对浏览器翻译功能、PDF 的文字层和原文语言。',
          'This page could not be translated. Check browser translation support, the PDF text layer and source language.');
      }
    } finally {
      if (translationRequest === request) translate.disabled = false;
    }
  }
  translate.addEventListener('click', translatePage);
  previousPage.addEventListener('click', () => { selected.page -= 1; translatePage(); });
  followingPage.addEventListener('click', () => { selected.page += 1; translatePage(); });
  reader.addEventListener('close', () => {
    translationRequest = null;
    translate.disabled = false;
    pageControls.hidden = translatedPage.hidden = true;
    frame.removeAttribute('src');
  });

  function readerButton(document, page) {
    const name = document.section + ' · ' + sections[document.section][english() ? 1 : 0];
    const title = page ? name + label(` · 第 ${page} 页`, ` · Page ${page}`) : name;
    const button = node('button', title, 'action');
    button.type = 'button';
    button.addEventListener('click', () => {
      selected = { document, page };
      fileLanguage.value = siteLanguage();
      reader.showModal();
      drawReader();
    });
    return button;
  }

  const sectionGuides = [
    ['C', 'C2–C3', '车身尺寸与空气动力学怎样核查？', 'How are dimensions and aerodynamics checked?',
      '先用 C2 确认车辆坐标系和基础尺寸，再用 C3 核对相关车身部件。高速状态下会产生形变的部件，还需查看对应的测试方法和通过标准。',
      'Start with C2 for the car’s reference system and basic dimensions, then check the relevant bodywork in C3. For components that deflect at speed, consult the applicable test method and acceptance limits.'],
    ['C', 'C4–C5', '车重和动力单元查哪里？', 'Where are mass and power unit requirements?',
      '整车质量及其检查条件在 C4。C5 涵盖动力单元的构成和技术约束。核对具体数值时，应确认适用赛季、测量条件和相关图表。',
      'C4 covers mass and the conditions under which it is measured. C5 covers power unit architecture and constraints. Check the applicable season, measurement conditions and diagrams when looking up a number.'],
    ['D', 'D4–D7', '怎样判断一项车队费用是否计入预算帽？', 'How do I check whether a team cost counts towards the cap?',
      '从 D4 的预算帽适用范围入手，结合 D5 的排除项和 D6 的调整规则判断费用如何计入，最后用 D7 核对申报要求。预算帽数字本身不能回答一笔费用应如何处理。',
      'Start with the scope in D4, then consider the exclusions in D5 and adjustments in D6. D7 covers reporting. The headline cap alone does not determine how an individual cost is treated.'],
    ['D', 'D8–D12', '车队财务规则怎样执行？', 'How are team financial rules enforced?',
      'D8 介绍预算帽的管理与审查，D9 规定相关裁决程序。若要区分车队违规、有关人员违规及可能的制裁，可分别查看 D10、D11 和 D12。',
      'D8 covers administration and review, and D9 sets out the adjudication process. For team breaches, individual breaches and potential sanctions, see D10, D11 and D12 respectively.'],
    ['E', 'E2–E5', '动力单元制造商的预算帽如何查？', 'Where is the power unit manufacturer cost cap?',
      'E 卷针对动力单元制造商。E2 规定义务和预算帽，E3 与 E4 分别处理排除项和调整，E5 规定报告。核对财务要求时先确定受约束主体属于车队还是制造商。',
      'Section E applies to power unit manufacturers. E2 covers obligations and the cap, E3 and E4 cover exclusions and adjustments, and E5 covers reporting. Identify whether the entity is a team or a manufacturer before applying a financial rule.'],
    ['F', 'F3–F5', '停工期、风洞和台架测试分别查哪里？', 'Where are shutdown, wind tunnel and test bench limits?',
      'F3 说明车队停工期的约束。查空气动力学测试先看 F4，其中包括风洞测试及相关例外。动力单元台架测试的限制在 F5 单独规定。',
      'F3 addresses team shutdown periods. Start with F4 for aerodynamic testing, including wind tunnel testing and exceptions. F5 separately limits power unit test bench activity.'],
  ];

  function guide(query) {
    const items = window.F1_CONTENT.rules.flatMap(item => {
      const [category, title, clause, body, general] = item;
      if (section && (general ? 'A' : 'B') !== section) return [];
      const references = clause.match(/[A-F]\d+(?:\.\d+)*/g) || [];
      const [titleEn, bodyEn] = translations[references[0]] || [];
      if (!titleEn || (query && ![category, title, clause, body, titleEn, bodyEn].some(text => text.toLowerCase().includes(query)))) return [];
      const entry = node('details', '', 'rule-item');
      const citation = references.join(' · ');
      entry.append(node('summary', label(title, titleEn)), node('p', label(body, bodyEn)), node('p', 'FIA · ' + citation, 'sub'));
      return [entry];
    });
    for (const [volume, reference, zh, en, bodyZh, bodyEn] of sectionGuides) {
      if (section && section !== volume) continue;
      if (query && ![reference, zh, en, bodyZh, bodyEn].some(text => text.toLowerCase().includes(query))) continue;
      const entry = node('details', '', 'rule-item');
      entry.append(node('summary', label(zh, en)), node('p', label(bodyZh, bodyEn)), node('p', 'FIA · ' + reference, 'sub'));
      items.push(entry);
    }
    if (items.length) results.append(node('h2', label('规则说明', 'Rules explained')), ...items);
  }
  function draw() {
    if (!data) return;
    const query = filter.value.trim().toLowerCase();
    const tokens = pageTerms(query);
    tabs.replaceChildren(...['', ...Object.keys(sections)].map(key => {
      const button = node('button', key ? key + ' · ' + sections[key][english() ? 1 : 0] : label('全部', 'All sections'), 'action');
      button.type = 'button';
      button.dataset.section = key;
      button.setAttribute('aria-pressed', String(key === section));
      return button;
    }));
    const matches = data.documents.filter(document => !section || document.section === section).flatMap(document => {
      if (!query) return [{ document }];
      if (!tokens?.length) return [];
      return document.pages.flatMap((terms, index) => {
        const words = new Set(terms.split(' '));
        return tokens.every(token => words.has(token)) ? [{ document, page: index + 1 }] : [];
      });
    });
    const status = node('p', data.documents.length ? query ?
      label(`匹配 ${matches.length} 页`, `${matches.length} matching pages`) :
      label(`${data.year} 赛季 · A–F 六卷完整原文`, `${data.year} season · Six complete volumes A–F`) :
      label('规则索引暂不可用。', 'The regulation index is unavailable.'), 'sub');
    status.setAttribute('role', 'status');
    results.replaceChildren(status);
    results.append(node('p', label(
      '查询结果定位到 FIA 原文页。可在站内打开完整 PDF，部分浏览器支持本地逐页翻译。',
      'Search results identify FIA source pages. Open a complete PDF here. Supported browsers can translate its text on this device.'), 'sub'));
    guide(query);
    if (query && tokens === null) results.append(node('p', label('可查询常见中文术语，或输入英文关键词和条款编号。', 'Use English keywords, article numbers, or supported Chinese terms.'), 'sub'));
    for (const { document, page } of matches.slice(0, visibleLimit)) {
      const row = node('article', '', 'rule-item regulation-result');
      row.append(readerButton(document, page));
      const issue = document.title.match(/\bIss\s+(\d+)/i)?.[1];
      row.append(node('p', label(`第 ${issue || '—'} 版 · ${document.pages.length} 页`, `Issue ${issue || '—'} · ${document.pages.length} pages`), 'sub'));
      results.append(row);
    }
    if (matches.length > visibleLimit) {
      const more = node('button', label('显示更多匹配页', 'Show more matching pages'), 'action');
      more.type = 'button';
      more.addEventListener('click', () => { visibleLimit += 60; draw(); results.querySelector('button:last-child')?.focus(); });
      results.append(more);
    }
  }
  filter.addEventListener('input', () => { visibleLimit = 60; draw(); });
  tabs.addEventListener('click', event => {
    const key = event.target.closest('button')?.dataset.section;
    if (key === undefined) return;
    section = key;
    visibleLimit = 60;
    draw();
    [...tabs.children].find(button => button.dataset.section === key)?.focus();
  });
  window.addEventListener('f1:language', () => {
    translationRequest = null;
    translate.disabled = false;
    translatedPage.hidden = pageControls.hidden = true;
    fileLanguage.value = siteLanguage();
    draw();
    drawReader();
  });
  window.F1_REGULATIONS = {
    open() {
      if (data) return draw();
      loading ??= fetch('./api/regulations.json', { cache: 'no-cache' })
        .then(response => { if (!response.ok) throw new Error('Index unavailable'); return response.json(); })
        .then(index => { data = index; draw(); })
        .catch(() => { data = { documents: [] }; draw(); data = undefined; })
        .finally(() => { loading = undefined; });
    },
  };
})();

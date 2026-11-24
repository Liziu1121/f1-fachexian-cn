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
  const frame = node('iframe');
  frame.hidden = true;
  const tools = node('div', '', 'regulation-reader-tools');
  tools.append(close, pickerLabel, picker);
  reader.append(readerTitle, tools, notice, frame);
  results.after(reader);

  const files = new Map();
  let selected;
  const fileKey = () => selected && [english() ? 'en' : 'zh', selected.document.url].join(':');
  function drawReader() {
    if (!selected || !reader.open) return;
    const { document, page } = selected;
    const name = document.section + ' · ' + sections[document.section][english() ? 1 : 0];
    readerTitle.textContent = name + (page ? label(` · 第 ${page} 页`, ` · Page ${page}`) : '');
    close.textContent = label('关闭', 'Close');
    pickerLabel.textContent = label('选择中文 PDF', 'Choose an English PDF');
    frame.title = readerTitle.textContent;
    const file = files.get(fileKey());
    const source = file ? file + '#page=' + (page || 1) : '';
    frame.hidden = !source;
    if (source && frame.getAttribute('src') !== source) frame.src = source;
    if (!source) frame.removeAttribute('src');
    notice.textContent = source ? '' : label(
      '请选择这一卷的完整中文 PDF。文件只在当前浏览器内打开。',
      'Choose the complete English PDF for this volume. The file opens only in this browser.');
  }
  picker.addEventListener('change', () => {
    const file = picker.files[0];
    if (!file || !/\.pdf$/i.test(file.name) || !selected) return;
    const key = fileKey();
    if (files.has(key)) URL.revokeObjectURL(files.get(key));
    files.set(key, URL.createObjectURL(new Blob([file], { type: 'application/pdf' })));
    picker.value = '';
    drawReader();
  });
  reader.addEventListener('close', () => frame.removeAttribute('src'));

  function readerButton(document, page) {
    const name = document.section + ' · ' + sections[document.section][english() ? 1 : 0];
    const title = page ? name + label(` · 第 ${page} 页`, ` · Page ${page}`) : name;
    const button = node('button', title, 'action');
    button.type = 'button';
    button.addEventListener('click', () => {
      selected = { document, page };
      reader.showModal();
      drawReader();
    });
    return button;
  }

  function guide(query) {
    if (section && !['A', 'B'].includes(section)) return;
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
      '查询结果定位到 FIA 原文页。完整文件可在站内打开本地 PDF，目前未收录 FIA 官方中文版。',
      'Search results identify the FIA source pages. You can open a complete local English PDF in the reader.'), 'sub'));
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
  window.addEventListener('f1:language', () => { draw(); drawReader(); });
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

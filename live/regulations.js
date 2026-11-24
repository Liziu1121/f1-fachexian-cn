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
  function documentLink(document, text, page) {
    const link = node('a', text, 'text-link');
    link.href = document.url + (page ? '#page=' + page : '');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
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
      label('规则索引暂不可用，可打开 FIA 原文目录。', 'Index unavailable. The official FIA directory is still available.'), 'sub');
    status.setAttribute('role', 'status');
    results.replaceChildren(status);
    if (query && tokens === null) results.append(node('p', label('可查询常见中文术语，或输入英文关键词和条款编号。', 'Use English keywords, article numbers, or supported Chinese terms.'), 'sub'));
    for (const { document, page } of matches.slice(0, visibleLimit)) {
      const row = node('article', '', 'rule-item regulation-result');
      const title = document.section + ' · ' + sections[document.section][english() ? 1 : 0];
      row.append(documentLink(document, page ? title + label(` · 第 ${page} 页`, ` · Page ${page}`) : title, page));
      row.append(node('p', document.title + ' · ' + document.published, 'sub'));
      if (!page) row.append(documentLink(document, label(`查看完整 PDF（${document.pages.length} 页）`, `Open complete PDF (${document.pages.length} pages)`)));
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
  window.addEventListener('f1:language', draw);
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

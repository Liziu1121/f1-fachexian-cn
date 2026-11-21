export function patchNews(js, replace) {
  const edit = (from, to) => { js = replace(js, from, to); };
  edit('  const newsReports=window.F1_NEWS_REPORTS;',
    '  const newsExtras=window.F1_CONTENT_EXTRAS;\n  const newsReports=window.F1_NEWS_REPORTS;');
  edit('return Boolean(newsReports[article.id]', 'return Boolean(newsExtras.notes[article.id]?.body?.length||newsReports[article.id]');
  edit('  function newsText(article,en=window.F1_LOCALE.english()) {',
    '  function originalNewsUrl(article) {\n'+
    '    const value=article.sourceUrl||article.url||(/^[A-Za-z0-9]{16,24}$/.test(article.id)?"https://www.formula1.com/en/latest/article/news."+article.id:"");\n'+
    '    try {\n'+
    '      const url=new URL(value);\n'+
    '      if(url.origin==="https://www.formula1.com"&&url.pathname.startsWith("/en/latest/")) return url.href;\n'+
    '    } catch {}\n'+
    '    return "";\n'+
    '  }\n\n'+
    '  function newsText(article,en=window.F1_LOCALE.english()) {');
  const oldText = '    if (en) return {title:article.titleEn||article.en?.[0]||article.title,summary:article.summaryEn||article.en?.[1]||article.summary};\n'+
    '    return {\n'+
    '      title:isChineseNewsText(article.title)?article.title:"中文标题待更新",\n'+
    '      summary:isChineseNewsText(article.summary)?article.summary:"这条报道的中文译文暂未就绪。"\n'+
    '    };';
  const newText = [
    '    const note=newsExtras.notes[article.id];',
    '    const choose=(zh,original)=>en?original||zh:isChineseNewsText(zh)?zh:original||zh;',
    '    const title=choose(note?.title||article.title,article.titleEn||article.en?.[0])||(en?"Formula 1 article":"F1 报道");',
    '    const selected=choose(note?.summary||article.summary,note?.summaryEn||article.summaryEn||article.en?.[1]);',
    '    const normalize=value=>value?.trim().toLowerCase().replace(/[.!?。！？]+$/,"");',
    '    const summary=normalize(selected)!==normalize(title)?selected:"";',
    '    return {title,summary};',
  ].join('\n');
  edit(oldText, newText);
  const oldMerge = js.match(/  let nextNewsFetch=0;[\s\S]*?(?=    const translated=new Set\(\);)/)?.[0];
  if (!oldMerge) throw new Error('The mirror’s news refresh implementation has changed.');
  const merge = [
    '  function mergeNewsFeed(feed) {',
    '    const changed=new Set(), waiting=[];',
    '    if (!Array.isArray(feed?.items)) return {changed,waiting};',
    '    const leadChanged=officialNewsLeadId!==feed.leadId;',
    '    officialNewsLeadId=feed.leadId;',
    '    for (const [id,stamp,titleEn,summaryEn,kind,image,zh,info] of feed.items) {',
    '      if (!id || !titleEn || !Number.isFinite(Date.parse(stamp))) continue;',
    '      let article=newsById.get(id);',
    '      if (!article) {',
    '        article={id,stamp,title:"",summary:"",titleEn,summaryEn,kind,image,archived:true};',
    '        newsById.set(id,article);',
    '        newsArchive.push(article);',
    '        changed.add(id);',
    '      }',
    '      if (info?.url && article.sourceUrl!==info.url) {',
    '        article.sourceUrl=info.url;',
    '        changed.add(id);',
    '      }',
    '      if (summaryEn && (info?.metadata||!article.summaryEn) && summaryEn!==article.summaryEn) {',
    '        article.summaryEn=summaryEn;',
    '        changed.add(id);',
    '      }',
    '      if (applyChineseNews(article,zh)) changed.add(id);',
    '      if (!isChineseNewsText(article.title)||(!isChineseNewsText(article.summary)&&article.summaryEn)) waiting.push(article);',
    '    }',
    '    if (changed.size) newsArchive.sort((a,b)=>b.stamp.localeCompare(a.stamp));',
    '    return {changed,waiting,leadChanged};',
    '  }',
    '',
    '  mergeNewsFeed(newsExtras.feed);',
    '  const translationAttempts=new Set();',
    '  let nextNewsFetch=0;',
    '  async function refreshNewsArchive() {',
    '    if (!canUseServer || Date.now()<nextNewsFetch) return;',
    '    nextNewsFetch=Date.now()+300000;',
    '    const feed=await api("news/latest",14000);',
    '    if (!Array.isArray(feed?.items)) { nextNewsFetch=Date.now()+60000; return; }',
    '    const {changed,waiting,leadChanged}=mergeNewsFeed(feed);',
    '    if (changed.size) {',
    '      updateNewsMonths();',
    '      redrawChangedNews(changed);',
    '    } else if (leadChanged && currentPage==="news" && qs("#newsDetail").hidden) {',
    '      drawNews(currentArticle);',
    '    }',
    '    if (window.F1_LOCALE.english()) return;',
    '',
  ].join('\n');
  edit(oldMerge, merge);
  edit('await Promise.all(waiting.slice(0,8).map(async article=>{',
    'await Promise.all(waiting.filter(article=>!translationAttempts.has(article.id)).slice(0,8).map(async article=>{\n'+
    '      translationAttempts.add(article.id);');
  edit('article.title||translateNewsInBrowser(article.titleEn),\n        same||article.summary?"":translateNewsInBrowser(article.summaryEn)',
    'isChineseNewsText(article.title)?article.title:translateNewsInBrowser(article.titleEn),\n'+
    '        same||isChineseNewsText(article.summary)||!article.summaryEn?"":translateNewsInBrowser(article.summaryEn)');
  edit('signal:AbortSignal.timeout(timeout),headers:{Accept:"application/json"}',
    'signal:AbortSignal.timeout(timeout),cache:path==="news/latest"?"no-cache":"default",headers:{Accept:"application/json"}');
  edit('function newsSpotlight(now=Date.now(),en=window.F1_LOCALE.english())', 'function newsSpotlight(now=Date.now())');
  edit('season tickets?|betting|bets|F1 Academy', 'season tickets?|betting|bet builder|bets|F1 Academy');
  edit('item.image&&Date.parse(item.stamp)<=now+300000&&\n        (en||isChineseNewsText(item.title))&&!promoOrOtherSeries.test',
    '(item.title||item.titleEn)&&Date.parse(item.stamp)<=now+300000&&\n        !promoOrOtherSeries.test');
  edit('const paragraphs=en&&article.en?.length>2?article.en.slice(2):article.body||[];\n      const intro=summary||title;',
    'const note=newsExtras.notes[article.id];\n'+
    '      const paragraphs=(en?note?.bodyEn:note?.body)||(en&&article.en?.length>2?article.en.slice(2):article.body||[]);\n'+
    '      const original=originalNewsUrl(article);\n'+
    '      const lang=value=>isChineseNewsText(value)?"zh-CN":"en";\n'+
    '      const intro=summary?\'<p class="news-intro" lang="\'+lang(summary)+\'">\'+safe(summary)+\'</p>\':"";');
  edit('const sectionName=hasNewsBody(article)?(en?"Report":"报道正文"):(en?"Archive brief":"档案简讯");',
    'const sectionName=hasNewsBody(article)?(en?"Report":"报道正文"):(en?"Article summary":"报道摘要");\n'+
    '      const source=original?\'<a class="action outline" target="_blank" rel="noopener noreferrer" href="\'+safe(original)+\'">\'+(en?"Read on Formula 1":"查看 F1 官方原文")+\'</a>\':"";\n'+
    '      const unavailable=intro||body||results?"":\'<p class="news-intro">\'+(en?"The publisher has not provided a summary.":"来源暂未提供摘要。")+\'</p>\';');
  edit('\' · \'+safe(newsDate(article))+\' · 北京时间</div><h1 class="page-title" tabindex="-1">\'+safe(title)',
    '\' · \'+safe(newsDate(article))+\' · 北京时间</div><h1 class="page-title" tabindex="-1" lang="\'+lang(title)+\'">\'+safe(title)');
  edit('\'<p class="news-intro">\'+safe(intro)+\'</p>\'+body+', 'intro+unavailable+body+');
  edit('\'<div class="switcher">\'+link+\'<span class="sub">\'+(en?"Source · Formula 1":"资料来源 · F1 官网")+\'</span></div></div>\'',
    '\'<div class="switcher">\'+link+source+\'</div></div>\'');
  edit('  if (canUseServer) setInterval(()=>{if(currentPage==="news"&&!document.hidden) refreshNewsArchive();},300000);',
    '  if (canUseServer) {\n'+
    '    const refreshVisibleNews=()=>{if(currentPage==="news"&&!document.hidden) refreshNewsArchive();};\n'+
    '    setInterval(refreshVisibleNews,60000);\n'+
    '    document.addEventListener("visibilitychange",refreshVisibleNews);\n'+
    '    window.addEventListener("f1:language",()=>{\n'+
    '      if(currentPage==="news"&&!window.F1_LOCALE.english()){nextNewsFetch=0;refreshVisibleNews();}\n'+
    '    });\n'+
    '  }');
  return js;
}

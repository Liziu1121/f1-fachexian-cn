export function patchNews(js, replace) {
  const edit = (from, to) => { js = replace(js, from, to); };
  edit('  const newsReports=window.F1_NEWS_REPORTS;',
    '  const newsExtras=window.F1_CONTENT_EXTRAS;\n  const newsReports=window.F1_NEWS_REPORTS;');
  edit('return Boolean(newsReports[article.id]', 'return Boolean(newsExtras.notes[article.id]?.body?.length||newsReports[article.id]');
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
    '      if (info?.source) article.source=info.source;',
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
  edit('  if (canUseServer) setInterval(()=>{if(currentPage==="news"&&!document.hidden) refreshNewsArchive();},300000);',
    '  if (canUseServer) {\n'+
    '    const refreshVisibleNews=()=>{if(currentPage==="news"&&!document.hidden) refreshNewsArchive();};\n'+
    '    setInterval(refreshVisibleNews,60000);\n'+
    '    document.addEventListener("visibilitychange",refreshVisibleNews);\n'+
    '    window.addEventListener("f1:language",()=>{\n'+
    '      if(currentPage==="news"&&!window.F1_LOCALE.english()){nextNewsFetch=0;refreshVisibleNews();}\n'+
    '    });\n'+
    '  }');
  const cardStart = js.indexOf('  function newsCard(');
  const archiveStart = js.indexOf('  function drawNewsArchive(', cardStart);
  if (cardStart < 0 || archiveStart < 0) throw new Error('News cards integration point unavailable');
  js = js.slice(0, cardStart) + `  function newsBody(article,en) {
    const note=newsExtras.notes[article.id];
    const full=en ? note?.fullTextEn : note?.fullTextZh;
    if (full?.length) return full.map(paragraph=>'<p>'+safe(paragraph)+'</p>').join("");
    const sections=newsReports[article.id];
    const paragraphs=(en?note?.bodyEn:note?.body)||(en&&article.en?.length>2?article.en.slice(2):article.body||[]);
    const content=sections?.length ? sections.map(([heading,zh,english])=>'<section class="news-section">'+
      (en||!heading?"":'<h2>'+safe(heading)+'</h2>')+'<p>'+safe(en?english:zh)+'</p></section>').join("")
      :paragraphs.map(paragraph=>'<p>'+safe(paragraph)+'</p>').join("");
    if (!content) return "";
    const {summary}=newsText(article,en);
    return (summary?'<p class="news-intro">'+safe(summary)+'</p>':"")+content;
  }

  function newsCard(item,lead=false,cover=false) {
    const {title}=newsText(item);
    const en=window.F1_LOCALE.english();
    const available=Boolean(newsBody(item,en));
    const label=available?(en?"Read on this site":"站内阅读"):(en?"Full text unavailable":"暂无站内全文");
    return '<article class="news-card'+(lead?' news-lead':'')+'">'+
      (cover&&item.image?'<div class="news-visual">'+newsCover(item,lead?1100:700,!lead)+'</div>':'')+
      '<div class="news-card-copy"><div class="race-kicker">'+safe(item.source||"F1")+" · "+safe(newsDate(item))+'</div><h2>'+
      '<button class="news-title-button" type="button" data-news-entry="'+safe(item.id)+'">'+safe(title)+'</button></h2>'+
      '<span class="sub">'+label+'</span></div></article>';
  }

` + js.slice(archiveStart);
  edit('    const bodyOnly=qs("#newsBodyOnly").checked;\n', '');
  edit('    const items=newsArchive.filter(item=>(!bodyOnly||hasNewsBody(item))&&', [
    '    const readable=newsArchive.filter(item=>Boolean(newsBody(item,window.F1_LOCALE.english())));',
    '    const items=readable.filter(item=>',
  ].join('\n'));
  const archiveBodyStart = js.indexOf('  function drawNewsArchive(');
  const archiveBodyEnd = js.indexOf('  function newsMonth(', archiveBodyStart);
  if (archiveBodyEnd < 0) throw new Error('News archive count integration point unavailable');
  js = js.slice(0, archiveBodyStart) + js.slice(archiveBodyStart, archiveBodyEnd)
    .replaceAll('newsArchive.length', 'readable.length') + js.slice(archiveBodyEnd);
  edit('["#newsSearch","input"],["#newsBodyOnly","change"]', '["#newsSearch","input"]');
  const detailStart = js.indexOf('    if(article){', js.indexOf('  function drawNews(id)'));
  const detailEnd = js.indexOf('    qs("#newsSpotlight").innerHTML=', detailStart);
  if (detailStart < 0 || detailEnd < 0) throw new Error('News detail integration point unavailable');
  js = js.slice(0, detailStart) + `    if(article){
      const en=window.F1_LOCALE.english();
      const {title}=newsText(article,en);
      const body=newsBody(article,en);
      const caption=en?article.captionEn||article.caption:article.caption;
      const context=newsSessions[article.id];
      const unavailable=en?"This report has no full text available on this site.":"此报道暂未提供可在本站刊登的全文。";
      detail.innerHTML='<button type="button" class="action news-back" data-news-entry="">'+(en?"Back to reports":"返回新闻列表")+'</button>'+
        '<header><p class="eyebrow">'+safe(article.source||"F1")+' · '+safe(newsDate(article))+'</p>'+
        '<h1 class="page-title" tabindex="-1">'+safe(title)+'</h1></header>'+
        (article.image?'<figure>'+newsCover(article,1280)+(caption?'<figcaption>'+safe(caption)+'</figcaption>':'')+'</figure>':'')+
        '<div class="news-body">'+(body||'<p class="sub">'+unavailable+'</p>')+
        (context?'<section class="news-session">'+newsSessionBody(...context,en)+'</section>':'')+'</div>';
      return;
    }
` + js.slice(detailEnd);
  js += `\n  document.addEventListener("click",event=>{
    const button=event.target.closest("button[data-news-entry]");
    if(!button)return;
    const id=button.dataset.newsEntry;
    location.hash="#/news"+(id?"/"+encodeURIComponent(id):"");
  });\n`;
  edit('      .filter(item=>(item.title||item.titleEn)&&Date.parse(item.stamp)<=now+300000&&',
    '      .filter(item=>Boolean(newsBody(item,window.F1_LOCALE.english()))&&(item.title||item.titleEn)&&Date.parse(item.stamp)<=now+300000&&');
  edit('    const lead=recent.find(item=>item.id===officialNewsLeadId)||', '    const lead=candidates.find(item=>item.id===officialNewsLeadId)||');
  edit(`<li><a class="text-link" href="'+route("news",article.id)+'">'+safe(article.title)+'</a></li>`,
    `<li><button type="button" class="paddock-news-button text-link" data-news-entry="'+safe(article.id)+'">'+safe(article.title)+'</button></li>`);
  edit('    return [lead,...candidates.filter(item=>item.id!==lead.id)].slice(0,4);',
    '    return lead?[lead,...candidates.filter(item=>item.id!==lead.id)].slice(0,4):[];');
  return js;
}

export function patchNews(js, replace) {
  const edit = (from, to) => { js = replace(js, from, to); };
  edit('  const newsReports=window.F1_NEWS_REPORTS;',
    '  const newsExtras=window.F1_CONTENT_EXTRAS;\n  const newsReports=window.F1_NEWS_REPORTS;');
  edit('  function hasNewsBody(article) {\n    return Boolean(newsReports[article.id]||newsSessions[article.id]||article.body?.length);',
    '  function hasNewsBody(article,en=window.F1_LOCALE.english()) {\n'+
    '    const note=newsExtras.notes[article.id];\n'+
    '    return Boolean((en?note?.fullTextEn:note?.fullTextZh)?.length||newsReports[article.id]?.length||'+
    '(en?note?.bodyEn:note?.body)?.length||(en&&article.en?.length>2)||article.body?.length);');
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
    '      if (info?.bodyRevision && newsExtras.notes[id]?.revision===info.bodyRevision &&',
    '          (article.bodyRevision!==info.bodyRevision || article.stamp!==stamp || article.titleEn!==titleEn)) {',
    '        article.bodyRevision=info.bodyRevision;',
    '        article.stamp=stamp;',
    '        article.titleEn=titleEn;',
    '        article.summaryEn="";',
    '        article.kind=kind;',
    '        changed.add(id);',
    '      }',
    '      if (info?.dateOnly) article.dateOnly=true;',
    '      if (info?.photoReference) {',
    '        if (article.image!==image || !article.photoReference) changed.add(id);',
    '        article.image=image;',
    '        article.photoReference=true;',
    '        article.photoArchived=info.photoArchived;',
    '        article.photoKind=info.photoKind;',
    '        article.photoCaption=info.photoCaption;',
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
    '    const needsBody=row=>row[7]?.bodyRevision&&newsExtras.notes[row[0]]?.revision!==row[7].bodyRevision;',
    '    if (feed.items.some(needsBody)) {',
    '      const bodies=await api("news/generated",14000);',
    '      for (const [id,,,,,,,info] of feed.items.filter(needsBody)) {',
    '        const body=bodies?.[id];',
    '        if (body?.revision===info.bodyRevision) newsExtras.notes[id]=body;',
    '      }',
    '      if (feed.items.some(needsBody)) nextNewsFetch=Date.now()+60000;',
    '    }',
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
    'signal:AbortSignal.timeout(timeout),cache:path.startsWith("news/")?"no-cache":"default",headers:{Accept:"application/json"}');
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
  edit('return item.stamp?time(item.stamp):item.date||snapshot;',
    'return item.dateOnly?new Intl.DateTimeFormat(window.F1_LOCALE.english()?"en-GB":"zh-CN",{month:"long",day:"numeric",timeZone:"UTC"}).format(new Date(item.stamp)):item.stamp?time(item.stamp):item.date||snapshot;');
  const coverStart = js.indexOf('  function newsCover(');
  const coverEnd = js.indexOf('  function newsDate(', coverStart);
  if (coverStart < 0 || coverEnd < 0) throw new Error('News cover integration point unavailable');
  js = js.slice(0, coverStart) + `  function newsCover(item,width,lazy,detail=false) {
    const en=window.F1_LOCALE.english();
    const selected=item.photoReference?item:newsExtras.newsStoryPhotos[item.id];
    const kind=selected?.photoKind||"editorial";
    if(!selected?.image||kind==="portrait") return {kind,markup:"",caption:""};
    const src=selected.image.replace("/c_fit,w_1600/","/c_fit,w_"+width+"/");
    const label=kind==="circuit"?(en?"Official circuit map":"F1 官方赛道图"):
      selected.photoArchived?(en?"Archive photo · Formula 1":"资料图 · F1 官方"):
      kind==="editorial"?(en?"On location · Formula 1":"现场图 · F1 官方"):
      (en?"Illustrative photo · Formula 1":"配图 · F1 官方");
    const description=selected.photoCaption?.[en?"en":"zh"]||"";
    const caption=description?description+" · "+label:label;
    const markup='<img src="'+safe(src)+'" alt="'+safe(detail?(description||label):"")+'" width="'+width+
      '" height="'+Math.round(width*9/16)+'" decoding="async"'+(lazy?' loading="lazy"':'')+'>';
    return {kind,markup,caption};
  }

` + js.slice(coverEnd);
  const cardStart = js.indexOf('  function newsCard(');
  const archiveStart = js.indexOf('  function drawNewsArchive(', cardStart);
  if (cardStart < 0 || archiveStart < 0) throw new Error('News cards integration point unavailable');
  js = js.slice(0, cardStart) + `  function newsBody(article,en) {
    const note=newsExtras.notes[article.id];
    const full=en ? note?.fullTextEn : note?.fullTextZh;
    if (full?.length) {
      const paragraphs=full.map(paragraph=>'<p>'+safe(paragraph)+'</p>').join("");
      const table=en ? note?.classification?.en : note?.classification?.zh;
      if (!table) return paragraphs;
      const title=en?"Session classification":"场次成绩";
      const headers=table.header.map(label=>'<th scope="col">'+safe(label)+'</th>').join("");
      const rows=table.rows.map(row=>'<tr>'+row.map(cell=>'<td>'+safe(cell)+'</td>').join("")+'</tr>').join("");
      return paragraphs+'<section class="news-section"><h2 id="newsClassificationTitle">'+title+'</h2>'+
        '<div class="table-wrap" role="region" tabindex="0" aria-labelledby="newsClassificationTitle">'+
        '<table><thead><tr>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
    }
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
    const available=hasNewsBody(item,en);
    const label=available?(en?"Read on this site":"站内阅读"):(en?"Full text unavailable":"暂无站内全文");
    const visual=cover?newsCover(item,lead?1200:cover==="thumb"?480:760,!lead):null;
    return '<article class="news-card'+(lead?' news-lead':'')+'">'+
      (visual?.markup?'<div class="news-visual" data-photo-kind="'+safe(visual.kind)+'">'+visual.markup+'</div>':'')+
      '<div class="news-card-copy"><div class="race-kicker">'+safe(item.source||"F1")+" · "+safe(newsDate(item))+'</div><h2>'+
      '<button class="news-title-button" type="button" data-news-entry="'+safe(item.id)+'">'+safe(title)+'</button></h2>'+
      '<span class="sub">'+label+'</span></div></article>';
  }

` + js.slice(archiveStart);
  edit('    const bodyOnly=qs("#newsBodyOnly").checked;\n', '');
  edit('    const items=newsArchive.filter(item=>(!bodyOnly||hasNewsBody(item))&&', [
    '    const readable=newsArchive.filter(item=>hasNewsBody(item));',
    '    const items=readable.filter(item=>',
  ].join('\n'));
  edit('[item.title,item.summary,item.titleEn,item.summaryEn,item.kind].some(value=>value?.toLowerCase().includes(word))',
    '[item.title,item.summary,item.titleEn,item.summaryEn,item.kind,item.source,...(newsExtras.notes[item.id]?.fullTextZh||[]),'+
    '...(newsExtras.notes[item.id]?.fullTextEn||[])].some(value=>value?.toLowerCase().includes(word))');
  edit('.map(item=>newsCard(item)).join("")', '.map(item=>newsCard(item,false,"thumb")).join("")');
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
      const visual=newsCover(article,1280,false,true);
      const sources=newsExtras.notes[id]?.sources;
      const attribution=sources?.length?
        '<p class="news-attribution sub">'+(en?"Reporting checked against ":"核对来源 · ")+safe(sources.join(" · "))+'</p>':"";
      const context=newsSessions[article.id];
      const unavailable=en?"This report has no full text available on this site.":"此报道暂未提供可在本站刊登的全文。";
      detail.innerHTML='<button type="button" class="action news-back" data-news-entry="">'+(en?"Back to reports":"返回新闻列表")+'</button>'+
        '<header><p class="eyebrow">'+safe(article.source||"F1")+' · '+safe(newsDate(article))+'</p>'+
        '<h1 class="page-title" tabindex="-1">'+safe(title)+'</h1></header>'+
        (visual.markup?'<figure data-photo-kind="'+safe(visual.kind)+'">'+visual.markup+
          '<figcaption>'+safe(visual.caption)+'</figcaption></figure>':'')+
        '<div class="news-body">'+(body||'<p class="sub">'+unavailable+'</p>')+attribution+
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
    '      .filter(item=>hasNewsBody(item)&&(item.title||item.titleEn)&&Date.parse(item.stamp)<=now+300000&&');
  edit('    const lead=recent.find(item=>item.id===officialNewsLeadId)||', '    const lead=candidates.find(item=>item.id===officialNewsLeadId)||');
  edit(`<li><a class="text-link" href="'+route("news",article.id)+'">'+safe(article.title)+'</a></li>`,
    `<li><button type="button" class="paddock-news-button text-link" data-news-entry="'+safe(article.id)+'">'+safe(article.title)+'</button></li>`);
  edit('    return [lead,...candidates.filter(item=>item.id!==lead.id)].slice(0,4);', [
    '    if (!lead) return [];',
    '    const imageKey=item=>{',
    '      const url=item.photoReference?item.image:newsExtras.newsStoryPhotos[item.id]?.image;',
    '      return url?.match(/\\/v\\d+\\/(.+)\\.[a-z]+$/i)?.[1]||url;',
    '    };',
    '    const selected=[lead], shown=new Set([imageKey(lead)]);',
    '    for(const item of candidates) {',
    '      if(item.id===lead.id)continue;',
    '      const key=imageKey(item);',
    '      if(key&&shown.has(key))continue;',
    '      selected.push(item);',
    '      shown.add(key);',
    '      if(selected.length===4)break;',
    '    }',
    '    return selected;',
  ].join('\n'));
  edit('    if (image.matches?.(".following-track-image[data-layout]")) {',
    '    if (image.matches?.(".news-visual img,.news-detail figure img")) {\n'+
    '      image.closest(".news-visual,figure").classList.add("photo-unavailable");\n'+
    '      return;\n'+
    '    }\n'+
    '    if (image.matches?.(".following-track-image[data-layout]")) {');
  return js;
}

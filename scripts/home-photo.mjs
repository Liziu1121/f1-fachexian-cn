export function patchHeroPhoto(js) {
  const start = js.indexOf('  const initialHeroStamp=');
  const end = js.indexOf('  function activateMotion()', start);
  if (start < 0 || end < 0) throw new Error('Home photo integration point unavailable');
  return js.slice(0, start) + `  const heroRefreshInterval=60000;
  let featuredRound, featuredPhoto, loadingRound;

  function heroRound(now=Date.now()) {
    const rounds=Object.entries(data.races).map(([key,race])=>{
      const starts=Object.entries(race.sessions).filter(([type])=>type!=="grid").map(([,date])=>Date.parse(date)).filter(Number.isFinite);
      return {key, start:Math.min(...starts)};
    }).filter(round=>Number.isFinite(round.start)).sort((a,b)=>a.start-b.start);
    return rounds.findLast(round=>round.start<=now) || rounds[0];
  }

  function syncHeroCaption() {
    const en=window.F1_LOCALE.english();
    const caption=qs("#heroCaption");
    if (!featuredPhoto || !featuredRound) return;
    const label=content.circuit[featuredRound.key]?.[en?1:0] || featuredRound.key;
    caption.textContent=label+(en?" · Official circuit photo":" · 官方赛道精选");
    caption.href=featuredPhoto.source;
    caption.target="_blank";
    caption.rel="noopener noreferrer";
  }

  async function refreshFeaturedPhoto() {
    if (currentPage!=="home" || document.hidden) return;
    const round=heroRound();
    if (!round || round.start===featuredRound?.start || round.start===loadingRound) return;
    const photos=window.F1_CONTENT_EXTRAS.galleries?.[round.key] || [];
    const score=photo=>/racehub/i.test(photo.image)?3:/trackside-images.*grand_prix/i.test(photo.image)&&!/practice|qualifying/i.test(photo.image)?2:1;
    const candidates=[...photos].sort((a,b)=>score(b)-score(a));
    loadingRound=round.start;
    try {
      for (const photo of candidates) {
        const incoming=new Image();
        incoming.src=photo.image;
        try { await incoming.decode(); } catch { continue; }
        if (currentPage!=="home" || document.hidden || heroRound()?.start!==round.start) return;
        const first=qs("[data-hero-frame].active");
        const second=qs("[data-hero-frame]:not(.active)");
        second.src=photo.image;
        second.alt="";
        second.style.setProperty("--shot-position","50% 50%");
        second.style.setProperty("--shot-mobile","50% 50%");
        second.removeAttribute("aria-hidden");
        second.classList.add("active");
        first.classList.remove("active");
        first.setAttribute("aria-hidden","true");
        featuredRound=round;
        featuredPhoto=photo;
        syncHeroCaption();
        return;
      }
    } finally {
      if (loadingRound===round.start) loadingRound=undefined;
    }
  }

` + js.slice(end);
}

export const circuitPhotoLimit = 12;
const livePhotoLimit = 10;
const mobileHeroMedia = '(max-width: 800px) and (orientation: portrait)';
const photoCdn = 'https://media.formula1.com/image/upload/';
const mobileFocus = {
  'qatar': 0.67, // Driver's helmet
  'abu dhabi': 0.51, // Car behind the tyre smoke
  'abu_dhabi': 0.51,
  'las vegas': 0.75, // Lead group of cars
  '2305972666': 0.58, // Gasly in the initial Las Vegas cover
  '2249216886': 0.64, // Qatar backup cover
};

function mobileHeroPhoto(image) {
  if (!image?.startsWith(photoCdn)) return '';
  const asset = image.match(/\/(v\d+\/[^?#]+)$/)?.[1];
  if (!asset) return '';
  const name = photoIdentity(image).split('/').at(-1).replace(/^photo:/, '');
  const x = mobileFocus[name];
  const crop = x ? `c_crop,g_xy_center,x_${x},y_0.5,ar_1:2,h_1.0/c_scale,w_780`
    : 'c_fill,g_auto:subject,w_780,h_1560';
  return `${photoCdn}${crop}/q_auto/${asset}`;
}

export function photoIdentity(image) {
  if (!image) return '';
  const path = image.match(/\/v\d+\/([^?#]+)/)?.[1] || image.split(/[?#]/, 1)[0];
  let asset;
  try { asset = decodeURIComponent(path); }
  catch { asset = path; }
  const name = asset.replace(/\.[^.]+$/, '').toLowerCase();
  const photoNumber = name.split('/').at(-1).match(/^(?:gettyimages[-_ ])?(\d{8,})$/)?.[1];
  return photoNumber ? 'photo:' + photoNumber : name;
}

function homePhotoScore({ image }) {
  if (/racehub|panorama|aerial/i.test(image)) return 3;
  return /trackside-images.*grand_prix/i.test(image) && !/practice|qualifying/i.test(image) ? 2 : 1;
}

export function circuitPhotoSelection(media, initialCover) {
  const pools = Object.entries(media).map(([round, { photos }]) =>
    [round, [...new Map(photos.filter(photo => photo.image).map(photo => [photoIdentity(photo.image), photo])).values()]]);
  const homePhotos = Object.fromEntries(pools.map(([round, photos]) => {
    const reserve = photos.length >= circuitPhotoLimit ? 2 : 1;
    return [round, [...photos].sort((a, b) => homePhotoScore(b) - homePhotoScore(a)).slice(0, reserve)
      .map(photo => ({ ...photo, mobileImage: mobileHeroPhoto(photo.image) }))];
  }));
  const reserved = new Set([photoIdentity(initialCover), ...Object.values(homePhotos).flat().map(photo => photoIdentity(photo.image))]);
  const galleries = Object.fromEntries(pools.map(([round, photos]) => {
    const distinct = photos.filter(photo => !reserved.has(photoIdentity(photo.image)));
    return [round, (distinct.length ? distinct : photos).slice(0, livePhotoLimit)];
  }));
  return { homePhotos, galleries };
}

export function patchHeroMarkup(html) {
  return html.replace(/<img\b[^>]*\bdata-hero-frame\b[^>]*>/g, frame => {
    const mobile = mobileHeroPhoto(frame.match(/\ssrc="([^"]+)"/)?.[1]);
    const srcset = mobile ? ` srcset="${mobile}"` : '';
    return `<picture><source media="${mobileHeroMedia}"${srcset}>${frame}</picture>`;
  });
}

export function patchHeroPhoto(js) {
  const start = js.indexOf('  const initialHeroStamp=');
  const end = js.indexOf('  function activateMotion()', start);
  if (start < 0 || end < 0) throw new Error('Home photo integration point unavailable');
  return js.slice(0, start) + `  const heroRefreshInterval=60000;
  const heroPortrait=matchMedia("${mobileHeroMedia}");
  let featuredRound, featuredPhoto, loadingRound;

  for (const frame of document.querySelectorAll("[data-hero-frame]")) {
    const fallback=()=>{ if (heroPortrait.matches) frame.previousElementSibling.removeAttribute("srcset"); };
    frame.addEventListener("error",fallback);
    if (frame.complete && frame.currentSrc && !frame.naturalWidth) fallback();
  }

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
    const candidates=window.F1_CONTENT_EXTRAS.homePhotos?.[round.key] || [];
    loadingRound=round.start;
    try {
      for (const photo of candidates) {
        let mobile=photo.mobileImage;
        const incoming=new Image();
        incoming.src=(heroPortrait.matches && mobile) || photo.image;
        try { await incoming.decode(); }
        catch {
          if (incoming.src===photo.image) continue;
          mobile="";
          incoming.src=photo.image;
          try { await incoming.decode(); } catch { continue; }
        }
        if (currentPage!=="home" || document.hidden || heroRound()?.start!==round.start) return;
        const first=qs("[data-hero-frame].active");
        const second=qs("[data-hero-frame]:not(.active)");
        if (mobile) second.previousElementSibling.srcset=mobile;
        else second.previousElementSibling.removeAttribute("srcset");
        second.src=photo.image;
        second.alt="";
        second.style.setProperty("--shot-position","50% 50%");
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

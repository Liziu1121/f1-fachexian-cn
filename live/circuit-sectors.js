(() => {
  "use strict";

  function shanghaiSectorMap(english) {
    const title = english ? "Shanghai International Circuit timing sectors" : "上海国际赛车场计时段示意";
    const description = english
      ? "The red line runs from the lap timing line to S1, the blue line from S1 to S2, and the yellow line from S2 back to the lap timing line."
      : "红线从圈计时线至 S1，蓝线从 S1 至 S2，黄线从 S2 返回圈计时线。";
    return `<svg class="sector-map" viewBox="0 0 702 420" role="img" aria-labelledby="sectorMapTitle sectorMapDesc">
      <title id="sectorMapTitle">${title}</title><desc id="sectorMapDesc">${description}</desc>
      <path class="sector-one" d="M222 355 L102 307 C60 292 42 279 45 251 C48 226 69 215 88 223 C105 230 104 245 91 251 C72 260 65 237 84 228 C107 216 147 238 157 209 C162 192 145 166 136 147"/>
      <path class="sector-two" d="M136 147 C126 129 118 115 130 109 C145 101 145 138 169 154 C194 170 221 180 244 174 C279 164 265 132 246 120 C232 110 235 100 255 104 C275 108 296 123 300 104 L296 89"/>
      <path class="sector-three" d="M296 89 C269 52 259 39 274 30 C286 23 302 34 299 45 C295 57 299 67 317 63 L588 24 C618 19 637 16 650 13 C665 8 669 20 653 29 L554 95 C542 103 551 112 543 118 C535 124 521 121 518 133 L511 170 C509 179 505 181 496 179 C470 175 447 178 430 198 L312 370 C302 383 295 381 281 376 L222 355"/>
      <g class="sector-marker">
        <circle cx="136" cy="147" r="6"/><text x="112" y="156" text-anchor="end">S1</text>
        <circle cx="296" cy="89" r="6"/><text x="313" y="101">S2</text>
        <circle cx="222" cy="355" r="6"/><text x="219" y="384" text-anchor="middle">S/F</text>
      </g>
    </svg>`;
  }

  function render(key, { diagram = false } = {}) {
    const details = window.F1_CONTENT_EXTRAS.sectors[key];
    if (!details) return "";
    const english = window.F1_LOCALE.english();
    const title = english ? "Timing sectors" : "计时段";
    const classes = ["sector-one", "sector-two", "sector-three"];
    const endpoints = details.lines.map(([metres, turn, direction]) => english
      ? `${metres} m ${direction} Turn ${turn}`
      : `${turn} 号弯${direction === "before" ? "前" : "后"} ${metres} 米`);
    endpoints.push(english ? "Lap timing line" : "圈计时线");
    const entries = details.lengths.map((length, index) =>
      `<li class="${classes[index]}"><b>S${index + 1}</b><strong>${length.toFixed(3)} km</strong><span>${english ? "Ends at" : "终点"} · ${endpoints[index]}</span></li>`
    ).join("");
    const strip = details.lengths.map((length, index) =>
      `<span class="${classes[index]}" style="flex-grow:${length}"></span>`
    ).join("");
    const sourceTitle = english ? "FIA circuit map (PDF)" : "FIA 官方赛道图（PDF）";
    return `<section class="track-sectors" aria-label="${title}">
      <header><h3>${title}</h3><a class="text-link" href="${details.source}#page=2" target="_blank" rel="noopener noreferrer">${sourceTitle}</a></header>
      ${diagram && key === "china" ? shanghaiSectorMap(english) : ""}
      <div class="sector-strip" aria-hidden="true">${strip}</div>
      <ol class="sector-details">${entries}</ol>
    </section>`;
  }

  window.F1_CIRCUIT_SECTORS = { render };
})();

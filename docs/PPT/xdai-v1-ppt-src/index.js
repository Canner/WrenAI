const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { autoFontSize, calcTextBox } = require('./pptxgenjs_helpers/text');
const { imageSizingContain, imageSizingCrop } = require('./pptxgenjs_helpers/image');
const { svgToDataUri } = require('./pptxgenjs_helpers/svg');
const { safeOuterShadow } = require('./pptxgenjs_helpers/util');
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require('./pptxgenjs_helpers/layout');

const docsDir = path.resolve(__dirname, '..');
const outputFile = path.join(docsDir, 'xdai-v1-ppt.pptx');
const sourceMd = path.join(docsDir, 'xdai-v1-ppt.md');
const referDir = path.join(docsDir, 'refer_dula');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'OpenAI Codex';
pptx.company = 'WrenAI';
pptx.subject = 'AI 数据分析平台 V1 产品与架构方案';
pptx.title = 'AI 数据分析平台 V1';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Hiragino Sans GB W6',
  bodyFontFace: 'Hiragino Sans GB W3',
  lang: 'zh-CN',
};
pptx.writeOptions = {
  compress: true,
};

const SW = 13.333;
const SH = 7.5;
const X0 = 0.72;
const TOP = 2.02;
const WHITE = 'FFFFFF';
const MUTED = '8A8F98';
const GOLD = 'F5C518';
const ORANGE = 'FF6B35';
const BG0 = '0A0E1A';
const BG1 = '0F1623';
const CARD = '1A1F2E';
const CARD_ALT = '151C2B';
const BORDER = '31384B';
const BORDER_STRONG = '434C64';
const CYAN = '5FD3FF';
const GREEN = '38D39F';
const RED = 'FF5A79';
const FONT_HEAD = 'Hiragino Sans GB W6';
const FONT_BODY = 'Hiragino Sans GB W3';
const FONT_MONO = 'Menlo';

if (!fs.existsSync(sourceMd)) {
  throw new Error(`Missing source markdown: ${sourceMd}`);
}

function img(name) {
  return path.join(referDir, name);
}

function toDataUri(svg) {
  return svgToDataUri(svg.replace(/\n\s+/g, ' ').trim());
}

function backgroundSvg(num, accent = GOLD) {
  const label = String(num).padStart(2, '0');
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#${BG0}"/>
        <stop offset="55%" stop-color="#0E1422"/>
        <stop offset="100%" stop-color="#${BG1}"/>
      </linearGradient>
      <radialGradient id="glowA" cx="78%" cy="16%" r="48%">
        <stop offset="0%" stop-color="#${accent}" stop-opacity="0.36"/>
        <stop offset="100%" stop-color="#${accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowB" cx="86%" cy="82%" r="30%">
        <stop offset="0%" stop-color="#${ORANGE}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#${ORANGE}" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
        <path d="M56 0H0V56" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/>
        <circle cx="0" cy="0" r="1.3" fill="#ffffff" fill-opacity="0.05"/>
      </pattern>
      <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#${accent}" stop-opacity="0.0"/>
        <stop offset="50%" stop-color="#${accent}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#${ORANGE}" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect width="1280" height="720" fill="url(#grid)"/>
    <circle cx="1060" cy="130" r="360" fill="url(#glowA)"/>
    <circle cx="1130" cy="640" r="230" fill="url(#glowB)"/>
    <path d="M0 90 H1280" stroke="url(#beam)" stroke-width="1" opacity="0.55"/>
    <path d="M0 614 H1280" stroke="#ffffff" stroke-width="1" opacity="0.03"/>
    <path d="M1010 58 h170 M1010 68 h120 M1010 78 h70" stroke="#${accent}" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round"/>
    <text x="46" y="678" font-family="Arial, sans-serif" font-size="248" font-weight="700" fill="#ffffff" opacity="0.035">${label}</text>
  </svg>`;
}

function heroIllustrationSvg() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="620" height="620" viewBox="0 0 620 620">
    <defs>
      <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1A2133" stop-opacity="0.96"/>
        <stop offset="100%" stop-color="#131A2A" stop-opacity="0.88"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#${GOLD}"/>
        <stop offset="100%" stop-color="#${ORANGE}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#${GOLD}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#${GOLD}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="620" height="620" rx="32" fill="none"/>
    <circle cx="430" cy="158" r="146" fill="url(#glow)" opacity="0.6"/>
    <rect x="242" y="68" width="272" height="182" rx="30" fill="url(#panel)" stroke="#ffffff" stroke-opacity="0.08"/>
    <rect x="138" y="214" width="324" height="208" rx="34" fill="url(#panel)" stroke="#ffffff" stroke-opacity="0.08"/>
    <rect x="266" y="306" width="236" height="160" rx="28" fill="url(#panel)" stroke="#ffffff" stroke-opacity="0.08"/>
    <path d="M310 148h98M310 168h138M310 188h88" stroke="#ffffff" stroke-opacity="0.72" stroke-width="8" stroke-linecap="round"/>
    <path d="M202 290h98M202 314h164M202 338h136" stroke="#ffffff" stroke-opacity="0.72" stroke-width="8" stroke-linecap="round"/>
    <rect x="182" y="360" width="132" height="18" rx="9" fill="#${GOLD}" opacity="0.95"/>
    <rect x="338" y="360" width="94" height="18" rx="9" fill="#${CYAN}" opacity="0.85"/>
    <path d="M458 138c18 0 32 14 32 32s-14 32-32 32-32-14-32-32 14-32 32-32z" fill="none" stroke="url(#accent)" stroke-width="8"/>
    <path d="M384 486c34-26 54-52 66-84m-66 84c-30-10-55-32-78-66m78 66c8 22 10 43 6 66" fill="none" stroke="#${GOLD}" stroke-width="4" stroke-opacity="0.88" stroke-linecap="round"/>
    <circle cx="450" cy="402" r="10" fill="#${GOLD}"/>
    <circle cx="306" cy="420" r="10" fill="#${ORANGE}"/>
    <circle cx="390" cy="550" r="10" fill="#${CYAN}"/>
  </svg>`;
}

function iconSvg(name, fg = WHITE, bg = '172033') {
  const common = `stroke="#${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const bgRect = `<rect x="4" y="4" width="88" height="88" rx="24" fill="#${bg}" fill-opacity="0.96" stroke="#ffffff" stroke-opacity="0.08"/>`;
  let glyph = '';
  switch (name) {
    case 'spark':
      glyph = `<path ${common} d="M48 20l8 18 18 8-18 8-8 18-8-18-18-8 18-8z"/><circle cx="69" cy="27" r="3" fill="#${fg}"/><circle cx="24" cy="69" r="3" fill="#${fg}"/>`;
      break;
    case 'database':
      glyph = `<ellipse ${common} cx="48" cy="26" rx="20" ry="8"/><path ${common} d="M28 26v28c0 4 9 8 20 8s20-4 20-8V26"/><path ${common} d="M28 40c0 4 9 8 20 8s20-4 20-8"/><path ${common} d="M28 54c0 4 9 8 20 8s20-4 20-8"/>`;
      break;
    case 'workflow':
      glyph = `<rect x="20" y="22" width="20" height="16" rx="4" ${common}/><rect x="56" y="22" width="20" height="16" rx="4" ${common}/><rect x="38" y="58" width="20" height="16" rx="4" ${common}/><path ${common} d="M40 30h16M48 38v18M58 30h16"/>`;
      break;
    case 'shield':
      glyph = `<path ${common} d="M48 18l22 10v18c0 14-8 24-22 30-14-6-22-16-22-30V28z"/><path ${common} d="M38 48l7 7 15-16"/>`;
      break;
    case 'layers':
      glyph = `<path ${common} d="M18 34l30-14 30 14-30 14z"/><path ${common} d="M26 48l22 10 22-10"/><path ${common} d="M34 62l14 7 14-7"/>`;
      break;
    case 'chart':
      glyph = `<path ${common} d="M22 70V28"/><path ${common} d="M22 70h52"/><rect x="30" y="46" width="9" height="16" rx="2" fill="#${fg}"/><rect x="45" y="36" width="9" height="26" rx="2" fill="#${fg}"/><rect x="60" y="28" width="9" height="34" rx="2" fill="#${fg}"/>`;
      break;
    case 'lock':
      glyph = `<rect x="28" y="40" width="40" height="28" rx="8" ${common}/><path ${common} d="M36 40v-8c0-8 5-14 12-14s12 6 12 14v8"/><circle cx="48" cy="54" r="3" fill="#${fg}"/>`;
      break;
    case 'api':
      glyph = `<path ${common} d="M30 30l-12 16 12 16"/><path ${common} d="M66 30l12 16-12 16"/><path ${common} d="M54 24L42 68"/>`;
      break;
    case 'terminal':
      glyph = `<path ${common} d="M24 30l14 12-14 12"/><path ${common} d="M46 58h24"/>`;
      break;
    default:
      glyph = `<circle cx="48" cy="48" r="18" ${common}/>`;
      break;
  }
  return toDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${bgRect}${glyph}</svg>`);
}

function fitText(text, x, y, w, h, maxFont, minFont, fontFace = FONT_HEAD, extra = {}) {
  return autoFontSize(text, fontFace, {
    x,
    y,
    w,
    h,
    fontSize: maxFont,
    minFontSize: minFont,
    maxFontSize: maxFont,
    leading: extra.leading ?? 1.05,
    margin: 0,
    padding: 0.02,
    mode: 'shrink',
    bold: extra.bold,
  });
}

function calcH(text, w, fontSize, opts = {}) {
  return calcTextBox(fontSize, {
    text,
    w,
    fontFace: opts.fontFace || FONT_BODY,
    leading: opts.leading ?? 1.28,
    margin: 0,
    padding: opts.padding ?? 0.02,
    bold: opts.bold,
  }).h;
}

function addBg(slide, num, accent = GOLD) {
  slide.addImage({ data: toDataUri(backgroundSvg(num, accent)), x: 0, y: 0, w: SW, h: SH });
}

function footer(slide, page) {
  slide.addText('WrenAI · AI DATA ANALYSIS PLATFORM V1', {
    x: 0.74,
    y: 7.07,
    w: 4.8,
    h: 0.18,
    fontFace: FONT_BODY,
    fontSize: 8.5,
    color: MUTED,
    margin: 0,
    charSpace: 1.2,
  });
  slide.addText(String(page).padStart(2, '0'), {
    x: 12.1,
    y: 7.01,
    w: 0.45,
    h: 0.24,
    fontFace: FONT_HEAD,
    fontSize: 11,
    color: GOLD,
    bold: true,
    align: 'right',
    margin: 0,
  });
}

function panel(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: opts.rectRadius || 0.12,
    fill: {
      color: opts.color || CARD,
      transparency: opts.transparency ?? 4,
    },
    line: {
      color: opts.lineColor || BORDER,
      transparency: opts.lineTransparency ?? 18,
      width: opts.lineWidth || 1,
    },
    shadow: opts.shadow === false ? undefined : safeOuterShadow('000000', 0.22, 45, 2, 1),
  });
}

function tag(slide, text, x, y, opts = {}) {
  const width = opts.w || Math.max(0.82, 0.3 + text.length * 0.11);
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: width,
    h: opts.h || 0.32,
    rectRadius: 0.05,
    fill: {
      color: opts.fill || GOLD,
      transparency: opts.fillTransparency ?? 0,
    },
    line: opts.outline
      ? {
          color: opts.line || BORDER_STRONG,
          transparency: 20,
          width: 1,
        }
      : {
          color: opts.fill || GOLD,
          transparency: 0,
          width: 1,
        },
  });
  slide.addText(text, {
    x,
    y: y + 0.02,
    w: width,
    h: opts.h || 0.32,
    fontFace: FONT_HEAD,
    fontSize: 9.5,
    bold: true,
    color: opts.textColor || BG0,
    align: 'center',
    margin: 0,
    charSpace: 0.5,
  });
  return width;
}

function outlineTag(slide, text, x, y, opts = {}) {
  const width = opts.w || Math.max(0.96, 0.34 + text.length * 0.115);
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: width,
    h: opts.h || 0.32,
    rectRadius: 0.05,
    fill: { color: BG1, transparency: 100 },
    line: { color: opts.line || BORDER_STRONG, transparency: 10, width: 1 },
  });
  slide.addText(text, {
    x,
    y: y + 0.02,
    w: width,
    h: opts.h || 0.32,
    fontFace: FONT_HEAD,
    fontSize: 9.2,
    bold: true,
    color: opts.textColor || WHITE,
    align: 'center',
    margin: 0,
    charSpace: 0.9,
  });
  return width;
}

function titleBlock(slide, sectionTag, titleText, subText) {
  tag(slide, sectionTag, X0, 0.58);
  const box = fitText(titleText, X0, 0.95, 7.0, 0.52, 30, 24, FONT_HEAD, { leading: 1.02 });
  slide.addText(titleText, {
    x: X0,
    y: 0.95,
    w: 7.0,
    h: 0.52,
    fontFace: FONT_HEAD,
    fontSize: box.fontSize,
    bold: true,
    color: WHITE,
    margin: 0,
  });
  slide.addText(subText.toUpperCase(), {
    x: X0,
    y: 1.58,
    w: 6.8,
    h: 0.22,
    fontFace: FONT_HEAD,
    fontSize: 11,
    color: MUTED,
    margin: 0,
    charSpace: 2.4,
  });
}

function addTextBox(slide, text, x, y, w, opts = {}) {
  const fontSize = opts.fontSize || 16;
  const fontFace = opts.fontFace || FONT_BODY;
  const height = calcH(text, w, fontSize, {
    fontFace,
    leading: opts.leading,
    padding: opts.padding,
    bold: opts.bold,
  });
  slide.addText(text, {
    x,
    y,
    w,
    h: opts.h || height,
    fontFace,
    fontSize,
    color: opts.color || MUTED,
    margin: 0,
    bold: opts.bold,
    valign: opts.valign || 'top',
    align: opts.align || 'left',
    breakLine: false,
    charSpace: opts.charSpace,
    italic: opts.italic,
  });
  return opts.h || height;
}

function addBulletList(slide, items, x, y, w, opts = {}) {
  const fontSize = opts.fontSize || 14.5;
  const gap = opts.gap || 0.12;
  const bulletColor = opts.bulletColor || GOLD;
  let cursorY = y;
  items.forEach((item) => {
    const textX = x + 0.22;
    const textW = w - 0.22;
    const h = calcH(item, textW, fontSize, {
      fontFace: opts.fontFace || FONT_BODY,
      leading: opts.leading || 1.26,
      padding: 0.02,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: cursorY + 0.07,
      w: 0.08,
      h: 0.08,
      fill: { color: bulletColor },
      line: { color: bulletColor },
    });
    slide.addText(item, {
      x: textX,
      y: cursorY,
      w: textW,
      h,
      fontFace: opts.fontFace || FONT_BODY,
      fontSize,
      color: opts.color || MUTED,
      margin: 0,
      bold: opts.bold || false,
      breakLine: false,
    });
    cursorY += h + gap;
  });
  return cursorY - y;
}

function infoCard(slide, cfg) {
  panel(slide, cfg.x, cfg.y, cfg.w, cfg.h, {
    color: cfg.color || CARD,
    lineColor: cfg.lineColor || BORDER,
    transparency: cfg.transparency ?? 0,
  });
  if (cfg.icon) {
    slide.addImage({ data: cfg.icon, x: cfg.x + 0.22, y: cfg.y + 0.18, w: 0.54, h: 0.54 });
  }
  if (cfg.kicker) {
    addTextBox(slide, cfg.kicker.toUpperCase(), cfg.x + (cfg.icon ? 0.88 : 0.22), cfg.y + 0.18, cfg.w - (cfg.icon ? 1.1 : 0.44), {
      fontFace: FONT_HEAD,
      fontSize: 9.2,
      color: GOLD,
      charSpace: 1.3,
      h: 0.16,
    });
  }
  const titleY = cfg.y + (cfg.kicker ? 0.42 : 0.22);
  addTextBox(slide, cfg.title, cfg.x + (cfg.icon ? 0.88 : 0.22), titleY, cfg.w - (cfg.icon ? 1.1 : 0.44), {
    fontFace: FONT_HEAD,
    fontSize: cfg.titleSize || 16,
    color: WHITE,
    bold: true,
    leading: 1.12,
  });
  if (cfg.body) {
    addTextBox(slide, cfg.body, cfg.x + 0.22, cfg.bodyY || (cfg.y + 0.86), cfg.w - 0.44, {
      fontSize: cfg.bodySize || 13.3,
      color: cfg.bodyColor || MUTED,
      leading: cfg.leading || 1.28,
    });
  }
  if (cfg.bullets) {
    addBulletList(slide, cfg.bullets, cfg.x + 0.22, cfg.bodyY || (cfg.y + 0.86), cfg.w - 0.44, {
      fontSize: cfg.bodySize || 13.2,
      color: cfg.bodyColor || MUTED,
      bulletColor: cfg.bulletColor || GOLD,
      gap: cfg.gap || 0.1,
    });
  }
}

function screenshotCard(slide, x, y, w, h, imagePath, title, subtitle) {
  panel(slide, x, y, w, h, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, title, x + 0.24, y + 0.18, w - 0.48, {
    fontFace: FONT_HEAD,
    fontSize: 14,
    color: WHITE,
    bold: true,
    h: 0.24,
  });
  if (subtitle) {
    addTextBox(slide, subtitle.toUpperCase(), x + 0.24, y + 0.43, w - 0.48, {
      fontFace: FONT_HEAD,
      fontSize: 8.6,
      color: MUTED,
      charSpace: 1.2,
      h: 0.16,
    });
  }
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + 0.22,
    y: y + 0.74,
    w: w - 0.44,
    h: h - 0.96,
    rectRadius: 0.08,
    fill: { color: '0C1220' },
    line: { color: BORDER, transparency: 24, width: 1 },
  });
  slide.addImage({ path: imagePath, ...imageSizingContain(imagePath, x + 0.26, y + 0.78, w - 0.52, h - 1.04) });
}

function finalize(slide) {
  if (process.env.SLIDES_STRICT_OVERLAP === '1') {
    warnIfSlideHasOverlaps(slide, pptx, { ignoreLines: true, ignoreDecorativeShapes: true });
  }
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

function buildCover() {
  const slide = pptx.addSlide();
  addBg(slide, 1, GOLD);
  const left = 0.74;
  const top = 0.72;
  const t1 = tag(slide, 'AI DATA ANALYSIS', left, top, { w: 1.7 });
  outlineTag(slide, 'V1 PROPOSAL', left + t1 + 0.14, top, { w: 1.42 });

  const coverTitle = 'AI 数据分析平台 V1';
  const titleBox = fitText(coverTitle, left, 1.62, 5.3, 0.78, 40, 30, FONT_HEAD, { leading: 1.0, bold: true });
  slide.addText(coverTitle, {
    x: left,
    y: 1.62,
    w: 5.3,
    h: 0.8,
    fontFace: FONT_HEAD,
    fontSize: titleBox.fontSize,
    bold: true,
    color: WHITE,
    margin: 0,
  });
  addTextBox(slide, '多租户生成式 BI 平台', left, 2.46, 5.2, {
    fontFace: FONT_HEAD,
    fontSize: 20,
    color: GOLD,
    bold: true,
    h: 0.32,
  });
  addTextBox(slide, '围绕 Workspace、知识库、Skill 与 NL2SQL 构建的企业级问数与运营闭环。', left, 3.0, 5.7, {
    fontSize: 16,
    color: MUTED,
    leading: 1.35,
  });

  panel(slide, left, 4.02, 2.32, 1.18, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '演讲者', left + 0.22, 4.2, 0.8, { fontFace: FONT_HEAD, fontSize: 9.2, color: GOLD, charSpace: 1.1, h: 0.15 });
  addTextBox(slide, 'WrenAI / Codex', left + 0.22, 4.46, 1.7, { fontFace: FONT_HEAD, fontSize: 14, color: WHITE, bold: true, h: 0.24 });
  panel(slide, left + 2.5, 4.02, 2.18, 1.18, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '日期', left + 2.72, 4.2, 0.45, { fontFace: FONT_HEAD, fontSize: 9.2, color: GOLD, charSpace: 1.1, h: 0.15 });
  addTextBox(slide, '2026.04.03', left + 2.72, 4.46, 1.3, { fontFace: FONT_HEAD, fontSize: 14, color: WHITE, bold: true, h: 0.24 });

  slide.addImage({ data: toDataUri(heroIllustrationSvg()), x: 7.15, y: 0.82, w: 5.42, h: 5.42 });
  panel(slide, 7.48, 5.38, 1.6, 0.84, { color: CARD, lineColor: BORDER_STRONG, transparency: 0 });
  slide.addImage({ data: iconSvg('spark', GOLD), x: 7.66, y: 5.55, w: 0.42, h: 0.42 });
  addTextBox(slide, 'Skill', 8.14, 5.56, 0.55, { fontFace: FONT_HEAD, fontSize: 12.6, color: WHITE, bold: true, h: 0.18 });
  addTextBox(slide, '确定性执行', 8.14, 5.78, 0.72, { fontSize: 9.5, color: MUTED, h: 0.16 });

  panel(slide, 9.26, 5.08, 1.74, 0.92, { color: CARD, lineColor: BORDER_STRONG, transparency: 0 });
  slide.addImage({ data: iconSvg('workflow', GOLD), x: 9.44, y: 5.27, w: 0.42, h: 0.42 });
  addTextBox(slide, 'Ask Flow', 9.92, 5.27, 0.8, { fontFace: FONT_HEAD, fontSize: 12.2, color: WHITE, bold: true, h: 0.18 });
  addTextBox(slide, '编排 / 回退 / Trace', 9.92, 5.49, 0.88, { fontSize: 9.3, color: MUTED, h: 0.16 });

  panel(slide, 11.16, 5.46, 1.46, 0.76, { color: CARD, lineColor: BORDER_STRONG, transparency: 0 });
  slide.addImage({ data: iconSvg('database', GOLD), x: 11.34, y: 5.62, w: 0.34, h: 0.34 });
  addTextBox(slide, 'NL2SQL', 11.74, 5.63, 0.56, { fontFace: FONT_HEAD, fontSize: 11.6, color: WHITE, bold: true, h: 0.16 });

  slide.addText('企业生成式 BI · Workspace · Knowledge Base · Skill · Dashboard', {
    x: left,
    y: 6.78,
    w: 6.6,
    h: 0.2,
    fontFace: FONT_HEAD,
    fontSize: 9,
    color: MUTED,
    margin: 0,
    charSpace: 1.3,
  });

  finalize(slide);
}

function buildPositioning() {
  const slide = pptx.addSlide();
  addBg(slide, 2);
  titleBlock(slide, '产品定位', 'AI 数据分析平台的产品定位', 'Generative BI platform');

  panel(slide, X0, TOP, 12.1, 1.2, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, 'AI 数据分析平台是一个面向企业的生成式 BI 平台。用户只需用自然语言提问，系统就会自动理解意图、查询数据、生成 SQL，并返回结果与图表。', X0 + 0.26, TOP + 0.23, 6.9, {
    fontSize: 15.5,
    color: WHITE,
    leading: 1.34,
  });
  addTextBox(slide, 'ASK', 8.7, TOP + 0.22, 0.5, { fontFace: FONT_HEAD, fontSize: 10.2, color: GOLD, charSpace: 1.3, h: 0.16 });
  addTextBox(slide, 'QUERY', 9.88, TOP + 0.22, 0.68, { fontFace: FONT_HEAD, fontSize: 10.2, color: GOLD, charSpace: 1.3, h: 0.16 });
  addTextBox(slide, 'VISUALIZE', 11.0, TOP + 0.22, 1.05, { fontFace: FONT_HEAD, fontSize: 10.2, color: GOLD, charSpace: 1.3, h: 0.16 });
  slide.addShape(pptx.ShapeType.line, { x: 8.54, y: TOP + 0.62, w: 3.08, h: 0, line: { color: BORDER_STRONG, width: 1.5 } });
  ['8.7', '9.86', '11.08'].forEach((x) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: Number(x), y: TOP + 0.54, w: 0.16, h: 0.16, fill: { color: GOLD }, line: { color: GOLD } });
  });

  const cards = [
    {
      title: '业务人员',
      kicker: 'Business users',
      icon: iconSvg('spark', GOLD),
      body: '用自然语言提问；平台自动理解问题、查询数据并生成图表，无需编写 SQL。',
      x: X0,
    },
    {
      title: '技术团队',
      kicker: 'Technical teams',
      icon: iconSvg('database', GOLD),
      body: '接入数据源构建知识库，把稳定的数据能力沉淀为场景 Skill，供业务人员复用。',
      x: 4.33,
    },
    {
      title: '运营团队',
      kicker: 'Operations',
      icon: iconSvg('chart', GOLD),
      body: '将结果固化到看板持续观测，或通过定时报表自动推送，实现稳定运营。',
      x: 8.66,
    },
  ];
  cards.forEach((card) => {
    infoCard(slide, { ...card, y: 3.54, w: 3.67, h: 2.28, bodySize: 13.4 });
  });

  footer(slide, 2);
  finalize(slide);
}

function buildProductStructure() {
  const slide = pptx.addSlide();
  addBg(slide, 3);
  titleBlock(slide, '产品结构', 'Workspace 与 Knowledge Base 的产品结构', 'Workspace / Knowledge Base');

  panel(slide, X0, TOP, 8.36, 4.88, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  panel(slide, X0 + 0.24, TOP + 0.24, 7.88, 0.64, { color: '1F2740', lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, 'Workspace（租户边界）', X0 + 0.46, TOP + 0.42, 3.1, {
    fontFace: FONT_HEAD,
    fontSize: 16.8,
    color: WHITE,
    bold: true,
    h: 0.24,
  });

  // child blocks
  const childY = TOP + 1.24;
  panel(slide, X0 + 0.28, childY, 2.1, 1.06, { color: CARD, lineColor: BORDER, transparency: 0 });
  slide.addImage({ data: iconSvg('shield', GOLD), x: X0 + 0.44, y: childY + 0.18, w: 0.44, h: 0.44 });
  addTextBox(slide, '成员管理 & 角色权限', X0 + 0.96, childY + 0.22, 1.2, { fontFace: FONT_HEAD, fontSize: 14.4, color: WHITE, bold: true });

  panel(slide, X0 + 2.62, childY - 0.04, 3.82, 2.78, { color: CARD, lineColor: GOLD, lineTransparency: 20, transparency: 0 });
  addTextBox(slide, '知识库（Knowledge Base）', X0 + 2.86, childY + 0.14, 2.26, { fontFace: FONT_HEAD, fontSize: 17.4, color: WHITE, bold: true, h: 0.25 });
  addTextBox(slide, '核心运营对象', X0 + 2.86, childY + 0.4, 1.4, { fontFace: FONT_HEAD, fontSize: 9, color: GOLD, charSpace: 1.1, h: 0.14 });

  const kbCards = [
    { t: '数据连接', s: 'Connector', x: X0 + 2.86, y: childY + 0.78, w: 1.1 },
    { t: '场景 Skill', s: 'Scenario skills', x: X0 + 4.06, y: childY + 0.78, w: 1.1 },
    { t: '资产目录', s: 'Tables / views / APIs / metrics', x: X0 + 5.26, y: childY + 0.78, w: 1.0 },
  ];
  kbCards.forEach((c) => {
    panel(slide, c.x, c.y, c.w, 0.92, { color: '202942', lineColor: BORDER_STRONG, transparency: 0 });
    addTextBox(slide, c.t, c.x + 0.12, c.y + 0.16, c.w - 0.24, { fontFace: FONT_HEAD, fontSize: 12.6, color: WHITE, bold: true, h: 0.18 });
    addTextBox(slide, c.s, c.x + 0.12, c.y + 0.42, c.w - 0.24, { fontSize: 8.8, color: MUTED, leading: 1.22 });
  });
  panel(slide, X0 + 2.86, childY + 1.82, 3.18, 0.68, { color: '202942', lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '知识资产：术语表 / 分析规则 / SQL 模板 / SQL 示例对 / 使用说明', X0 + 3.02, childY + 2.03, 2.86, {
    fontSize: 11.6,
    color: WHITE,
    leading: 1.18,
  });

  panel(slide, X0 + 0.28, TOP + 3.26, 2.36, 1.02, { color: CARD, lineColor: BORDER, transparency: 0 });
  slide.addImage({ data: iconSvg('chart', GOLD), x: X0 + 0.44, y: TOP + 3.45, w: 0.42, h: 0.42 });
  addTextBox(slide, '数据看板', X0 + 0.94, TOP + 3.48, 0.8, { fontFace: FONT_HEAD, fontSize: 15, color: WHITE, bold: true, h: 0.2 });
  addTextBox(slide, '多个，看板绑定具体知识库执行', X0 + 0.94, TOP + 3.73, 1.36, { fontSize: 10.2, color: MUTED, h: 0.18 });

  panel(slide, X0 + 5.72, TOP + 3.26, 2.4, 1.02, { color: CARD, lineColor: BORDER, transparency: 0 });
  slide.addImage({ data: iconSvg('terminal', GOLD), x: X0 + 5.88, y: TOP + 3.45, w: 0.42, h: 0.42 });
  addTextBox(slide, '定时任务', X0 + 6.38, TOP + 3.48, 0.82, { fontFace: FONT_HEAD, fontSize: 15, color: WHITE, bold: true, h: 0.2 });
  addTextBox(slide, '调度 / 推送 / 绑定具体知识库执行', X0 + 6.38, TOP + 3.73, 1.36, { fontSize: 10.2, color: MUTED, h: 0.18 });

  // lines
  slide.addShape(pptx.ShapeType.line, { x: X0 + 4.25, y: TOP + 0.88, w: 0, h: 0.28, line: { color: GOLD, width: 1.4 } });
  [[X0 + 1.3, childY], [X0 + 4.53, childY - 0.04], [X0 + 1.48, TOP + 3.26], [X0 + 6.92, TOP + 3.26]].forEach(([x, y]) => {
    slide.addShape(pptx.ShapeType.line, { x: X0 + 4.25, y: TOP + 1.16, w: x - (X0 + 4.25), h: y - (TOP + 1.16), line: { color: BORDER_STRONG, width: 1.1 } });
  });

  infoCard(slide, {
    x: 9.48,
    y: TOP,
    w: 3.32,
    h: 4.88,
    icon: iconSvg('layers', GOLD),
    kicker: 'Design cues',
    title: 'Workspace 之上是租户边界，知识库之中是可执行资产。',
    titleSize: 16,
    bullets: [
      '知识库聚合数据连接、场景 Skill 与知识资产。',
      '看板与定时任务绑定到具体知识库执行。',
      '能力沉淀路径：探索问题 → 固化规则 → 复用资产。',
    ],
    bodyY: TOP + 1.34,
    bodySize: 13.2,
  });

  footer(slide, 3);
  finalize(slide);
}

function buildKnowledgeBase() {
  const slide = pptx.addSlide();
  addBg(slide, 4);
  titleBlock(slide, '知识库', '知识库：隔离与沉淀的核心单元', 'Knowledge base isolation');

  infoCard(slide, {
    x: X0,
    y: TOP,
    w: 5.88,
    h: 2.28,
    icon: iconSvg('layers', GOLD),
    kicker: 'Core object',
    title: '知识库是用户面对的核心运营对象。',
    body: '每个 Workspace 下可管理多个知识库，每个知识库都独立维护自己的数据连接、资产目录、知识资产与场景 Skill。',
    bodyY: TOP + 0.94,
    bodySize: 14.2,
  });
  infoCard(slide, {
    x: X0,
    y: TOP + 2.54,
    w: 5.88,
    h: 2.34,
    icon: iconSvg('shield', GOLD),
    kicker: 'Isolation model',
    title: '知识库隔离',
    bullets: [
      '不同知识库的数据、规则与对话上下文互不干扰。',
      'Thread 创建时绑定到具体知识库，全程不切换。',
      '权限、执行配置与审计边界都以知识库为单位。',
    ],
    bodyY: TOP + 3.46,
    bodySize: 13.6,
  });

  const rightX = 6.72;
  infoCard(slide, {
    x: rightX,
    y: TOP,
    w: 2.02,
    h: 1.5,
    icon: iconSvg('database', GOLD),
    kicker: 'Assets',
    title: '数据连接与资产',
    body: '表 / 视图 / API / 指标',
    bodyY: TOP + 0.92,
    bodySize: 12.4,
  });
  infoCard(slide, {
    x: rightX + 2.22,
    y: TOP,
    w: 2.02,
    h: 1.5,
    icon: iconSvg('spark', GOLD),
    kicker: 'Logic',
    title: '场景 Skill',
    body: '把高频稳定查询沉淀为确定性执行单元',
    bodyY: TOP + 0.92,
    bodySize: 11.6,
  });
  infoCard(slide, {
    x: rightX + 4.44,
    y: TOP,
    w: 1.72,
    h: 1.5,
    icon: iconSvg('terminal', GOLD),
    kicker: 'Thread',
    title: '绑定执行',
    body: 'Ask / Dashboard / Schedule',
    bodyY: TOP + 0.92,
    bodySize: 10.2,
  });

  panel(slide, rightX, TOP + 1.78, 4.42, 3.1, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '知识资产包', rightX + 0.26, TOP + 2.02, 1.4, { fontFace: FONT_HEAD, fontSize: 18, color: WHITE, bold: true, h: 0.24 });
  addTextBox(slide, '术语 / 规则 / 模板 / 示例 / Instruction', rightX + 0.26, TOP + 2.3, 3.4, { fontFace: FONT_HEAD, fontSize: 8.8, color: GOLD, charSpace: 0.9, h: 0.16 });
  const knowledgeBullets = [
    '术语表：业务词到字段、指标的显式映射。',
    '分析规则：内化口径与业务计算逻辑。',
    'SQL 模板 / SQL 示例对：提供可复用查询结构。',
    'Instruction：告诉模型如何解释与回答结果。',
  ];
  addBulletList(slide, knowledgeBullets, rightX + 0.28, TOP + 2.64, 3.86, { fontSize: 12.2, color: MUTED, gap: 0.08 });

  panel(slide, rightX + 4.66, TOP + 1.78, 1.5, 3.1, { color: '202942', lineColor: GOLD, transparency: 0 });
  addTextBox(slide, 'THREAD', rightX + 4.92, TOP + 2.06, 0.8, { fontFace: FONT_HEAD, fontSize: 10.2, color: GOLD, charSpace: 1.6, h: 0.16 });
  addTextBox(slide, '对话在创建时绑定知识库，后续检索、执行与审计都沿着同一边界运行。', rightX + 4.92, TOP + 2.42, 1.02, {
    fontSize: 10.6,
    color: WHITE,
    leading: 1.36,
  });
  slide.addShape(pptx.ShapeType.line, { x: rightX + 5.36, y: TOP + 4.1, w: 0, h: 0.36, line: { color: GOLD, width: 2 } });
  slide.addShape(pptx.ShapeType.ellipse, { x: rightX + 5.28, y: TOP + 4.46, w: 0.16, h: 0.16, fill: { color: GREEN }, line: { color: GREEN } });
  addTextBox(slide, 'Isolated', rightX + 4.92, TOP + 4.68, 0.56, { fontSize: 8.8, color: MUTED, h: 0.14 });

  footer(slide, 4);
  finalize(slide);
}

function buildAskFlow() {
  const slide = pptx.addSlide();
  addBg(slide, 5);
  titleBlock(slide, '问数编排流程', '问数编排的主流程', 'Ask orchestration flow');

  const nodes = [
    { x: 0.78, y: 2.34, w: 1.56, h: 0.96, title: '用户提问', sub: 'Natural language question', icon: 'spark' },
    { x: 2.66, y: 2.34, w: 1.86, h: 0.96, title: '装配上下文', sub: '术语 / 规则 / 模板', icon: 'layers' },
    { x: 4.92, y: 2.18, w: 1.72, h: 1.28, title: 'SkillRouter', sub: '路由 / 回退 / Trace', icon: 'workflow' },
    { x: 7.16, y: 1.62, w: 2.18, h: 1.06, title: '命中场景 Skill', sub: 'Isolated Runner → 结构化结果', icon: 'spark' },
    { x: 7.16, y: 3.26, w: 2.18, h: 1.18, title: 'NL2SQL 引擎', sub: '生成 SQL → 执行 → 纠错重试', icon: 'database' },
    { x: 10.0, y: 2.34, w: 2.42, h: 0.96, title: 'MixedAnswerComposer', sub: '最终回答 + 图表', icon: 'chart' },
  ];
  nodes.forEach((n) => {
    panel(slide, n.x, n.y, n.w, n.h, { color: CARD, lineColor: n.title.includes('SkillRouter') ? GOLD : BORDER_STRONG, transparency: 0 });
    slide.addImage({ data: iconSvg(n.icon, n.title.includes('SkillRouter') ? GOLD : WHITE), x: n.x + 0.18, y: n.y + 0.2, w: 0.38, h: 0.38 });
    addTextBox(slide, n.title, n.x + 0.66, n.y + 0.2, n.w - 0.82, { fontFace: FONT_HEAD, fontSize: n.title.includes('MixedAnswerComposer') ? 13.4 : 14.2, color: WHITE, bold: true, h: 0.2 });
    addTextBox(slide, n.sub, n.x + 0.18, n.y + 0.56, n.w - 0.36, { fontSize: 10.8, color: MUTED, leading: 1.2 });
  });

  const lines = [
    [2.34, 2.82, 0.32, 0],
    [4.52, 2.82, 0.4, 0],
    [6.64, 2.82, 0.52, -0.66],
    [6.64, 2.82, 0.52, 1.02],
    [9.34, 2.15, 0.66, 0.67],
    [9.34, 3.86, 0.66, -1.02],
  ];
  lines.forEach(([x, y, w, h]) => {
    slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: { color: x === 6.64 ? GOLD : BORDER_STRONG, width: 1.4 } });
  });
  [[6.62, 2.74], [6.62, 2.9], [9.84, 2.74], [9.84, 2.9]].forEach(([x, y]) => {
    slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.1, h: 0.1, fill: { color: GOLD }, line: { color: GOLD } });
  });
  addTextBox(slide, '命中场景 Skill', 7.28, 1.36, 1.2, { fontFace: FONT_HEAD, fontSize: 8.8, color: GOLD, charSpace: 0.8, h: 0.14 });
  addTextBox(slide, '未命中 → 进入 SQL 语义引擎', 7.18, 4.56, 1.8, { fontFace: FONT_HEAD, fontSize: 8.8, color: GOLD, charSpace: 0.8, h: 0.14 });

  infoCard(slide, {
    x: 0.82,
    y: 5.42,
    w: 3.68,
    h: 1.08,
    icon: iconSvg('chart', GOLD),
    kicker: 'Composable',
    title: 'Skill 与 SQL 结果可混合组合',
    body: '面向复杂回答，系统可将多条执行路径统一编排与组织。',
    bodyY: 6.02,
    bodySize: 11,
  });
  infoCard(slide, {
    x: 4.84,
    y: 5.42,
    w: 3.48,
    h: 1.08,
    icon: iconSvg('shield', GOLD),
    kicker: 'Fallback',
    title: '任何路径失败都可以回退',
    body: '优先确定性执行，失败时退回到更通用但可观测的方案。',
    bodyY: 6.02,
    bodySize: 11,
  });
  infoCard(slide, {
    x: 8.64,
    y: 5.42,
    w: 3.86,
    h: 1.08,
    icon: iconSvg('terminal', GOLD),
    kicker: 'Traceability',
    title: '全链路 Trace',
    body: '问题理解、检索、生成、执行与回答都可观测与审计。',
    bodyY: 6.02,
    bodySize: 11,
  });

  footer(slide, 5);
  finalize(slide);
}

function buildSkillSlide() {
  const slide = pptx.addSlide();
  addBg(slide, 6);
  titleBlock(slide, '场景 Skill', '场景 Skill：确定性执行层', 'Deterministic execution layer');

  infoCard(slide, {
    x: X0,
    y: TOP,
    w: 7.18,
    h: 1.46,
    icon: iconSvg('spark', GOLD),
    kicker: 'Deterministic lane',
    title: 'Skill 适用于相对确定的业务场景。',
    body: '固定报表、ROI 计算、标准看板等场景可以绕过 LLM，直接执行已知逻辑，保证结果的确定性与稳定性。高频稳定的探索性查询也可以逐步沉淀为 Skill，形成“探索 → 固化 → 提速”的飞轮。',
    bodyY: TOP + 0.88,
    bodySize: 12.9,
  });

  const skillCards = [
    {
      x: X0,
      title: 'API Skill',
      body: '调用外部 / 内部 REST API，快速封装已有业务能力。',
      icon: iconSvg('api', GOLD),
    },
    {
      x: 3.02,
      title: 'DB Skill',
      body: '直接连接数据库执行固定 SQL 或视图查询。',
      icon: iconSvg('database', GOLD),
    },
    {
      x: 5.32,
      title: '复合 Skill',
      body: '多步 Agent 流程：先 API，再聚合，再格式化输出。',
      icon: iconSvg('workflow', GOLD),
    },
  ];
  skillCards.forEach((c) => {
    infoCard(slide, {
      x: c.x,
      y: 3.88,
      w: 2.08,
      h: 1.76,
      icon: c.icon,
      kicker: 'Skill type',
      title: c.title,
      body: c.body,
      bodyY: 4.62,
      bodySize: 11.7,
      titleSize: 14.6,
    });
  });

  infoCard(slide, {
    x: 7.64,
    y: TOP,
    w: 5.18,
    h: 4.88,
    icon: iconSvg('shield', GOLD),
    kicker: 'Platform guarantees',
    title: '系统保证 Skill 以安全、统一、可审计的方式运行。',
    bullets: [
      '隔离执行：独立 worker，不影响主服务稳定性。',
      '统一注入用户身份、加密凭证与连接配置。',
      '输出格式统一：表格 / 指标 / 文本 / 图表。',
      '完整审计日志，以及超时与资源限制。',
    ],
    bodyY: TOP + 1.22,
    bodySize: 13.1,
  });
  slide.addShape(pptx.ShapeType.line, { x: 8.04, y: 5.46, w: 3.9, h: 0, line: { color: BORDER_STRONG, width: 1.4 } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 8.0, y: 5.38, w: 0.16, h: 0.16, fill: { color: GOLD }, line: { color: GOLD } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.88, y: 5.38, w: 0.16, h: 0.16, fill: { color: ORANGE }, line: { color: ORANGE } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 11.76, y: 5.38, w: 0.16, h: 0.16, fill: { color: GREEN }, line: { color: GREEN } });
  addTextBox(slide, '探索', 7.92, 5.64, 0.5, { fontFace: FONT_HEAD, fontSize: 9.5, color: MUTED, h: 0.16 });
  addTextBox(slide, '固化', 9.82, 5.64, 0.5, { fontFace: FONT_HEAD, fontSize: 9.5, color: MUTED, h: 0.16 });
  addTextBox(slide, '提速', 11.68, 5.64, 0.5, { fontFace: FONT_HEAD, fontSize: 9.5, color: MUTED, h: 0.16 });

  footer(slide, 6);
  finalize(slide);
}

function buildNl2Sql() {
  const slide = pptx.addSlide();
  addBg(slide, 7);
  titleBlock(slide, '语义引擎 NL2SQL', '语义引擎：自然语言到 SQL', 'Natural language to SQL');

  panel(slide, X0, TOP, 5.34, 4.92, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '工作方式', X0 + 0.26, TOP + 0.22, 1.0, { fontFace: FONT_HEAD, fontSize: 18, color: WHITE, bold: true, h: 0.24 });
  const steps = [
    '1. 用户提问后先做意图分类，判断是否进入 NL2SQL 路径。',
    '2. 从知识库检索 schema、SQL 示例与使用说明作为上下文。',
    '3. LLM 结合上下文生成 SQL。',
    '4. SQL 在语义层校验并执行，失败时自动纠错重试。',
    '5. 返回结构化结果，并进一步生成图表。',
  ];
  let stepY = TOP + 0.72;
  steps.forEach((step, i) => {
    panel(slide, X0 + 0.24, stepY, 4.86, 0.68, { color: i === 2 ? '202942' : CARD, lineColor: i === 2 ? GOLD : BORDER, transparency: 0 });
    addTextBox(slide, step, X0 + 0.48, stepY + 0.18, 4.36, { fontSize: 12.8, color: i === 2 ? WHITE : MUTED, leading: 1.18 });
    stepY += 0.8;
  });

  panel(slide, 6.38, TOP, 6.46, 4.92, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, '精度增强机制', 6.64, TOP + 0.22, 1.4, { fontFace: FONT_HEAD, fontSize: 18, color: WHITE, bold: true, h: 0.24 });
  const mechanisms = [
    ['术语表', '确保业务词汇映射到正确字段。', 'layers'],
    ['分析规则', '把业务逻辑显式注入生成过程。', 'shield'],
    ['SQL 模板', '复用已验证的高频查询模式。', 'terminal'],
    ['SQL 示例对', '用历史样例提升结构与口径准确率。', 'chart'],
  ];
  mechanisms.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    infoCard(slide, {
      x: 6.62 + col * 3.1,
      y: TOP + 0.72 + row * 1.78,
      w: 2.86,
      h: 1.5,
      icon: iconSvg(m[2], GOLD),
      kicker: 'Accuracy lever',
      title: m[0],
      body: m[1],
      bodyY: TOP + 1.48 + row * 1.78,
      bodySize: 12.1,
      titleSize: 14.8,
    });
  });

  footer(slide, 7);
  finalize(slide);
}

function buildAuth() {
  const slide = pptx.addSlide();
  addBg(slide, 8);
  titleBlock(slide, '账号与权限', '账号体系与权限边界', 'Identity and authorization');

  infoCard(slide, {
    x: X0,
    y: TOP,
    w: 3.88,
    h: 4.8,
    icon: iconSvg('lock', GOLD),
    kicker: 'Identity',
    title: '账号体系',
    bullets: [
      '支持邮箱 + 密码，SSO / OIDC。',
      '首个用户自动成为 Owner。',
      '支持邀请成员协作。',
    ],
    bodyY: TOP + 1.02,
    bodySize: 13.3,
  });

  infoCard(slide, {
    x: 4.28,
    y: TOP,
    w: 4.18,
    h: 4.8,
    icon: iconSvg('shield', GOLD),
    kicker: 'Permission hierarchy',
    title: '权限层级',
    bodyY: TOP + 1.06,
  });
  const px = 4.56;
  [['Workspace 级', '成员可见哪些知识库'], ['知识库级', '成员能否读 / 写 / 管理'], ['细粒度', '支持行列级权限']].forEach((item, idx) => {
    panel(slide, px, TOP + 1.18 + idx * 1.08, 3.62, 0.86, { color: idx === 0 ? '202942' : CARD, lineColor: idx === 0 ? GOLD : BORDER, transparency: 0 });
    addTextBox(slide, item[0], px + 0.18, TOP + 1.42 + idx * 1.08, 0.9, { fontFace: FONT_HEAD, fontSize: 13.8, color: WHITE, bold: true, h: 0.18 });
    addTextBox(slide, item[1], px + 1.26, TOP + 1.42 + idx * 1.08, 2.0, { fontSize: 11.9, color: MUTED, h: 0.18 });
  });

  infoCard(slide, {
    x: 8.84,
    y: TOP,
    w: 3.98,
    h: 4.8,
    icon: iconSvg('shield', GOLD),
    kicker: 'Security stance',
    title: 'Deny-by-default',
    body: '缺少授权时默认拒绝，不静默放行。所有跨边界访问都需要显式授权与可审计记录。',
    bodyY: TOP + 1.0,
    bodySize: 13.2,
  });
  [['成功', GREEN], ['处理中', GOLD], ['拒绝', RED]].forEach((item, idx) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: 9.12, y: TOP + 3.48 + idx * 0.38, w: 0.12, h: 0.12, fill: { color: item[1] }, line: { color: item[1] } });
    addTextBox(slide, item[0], 9.34, TOP + 3.46 + idx * 0.38, 0.6, { fontSize: 10.2, color: MUTED, h: 0.16 });
  });

  footer(slide, 8);
  finalize(slide);
}

function buildArchitecture() {
  const slide = pptx.addSlide();
  addBg(slide, 9);
  titleBlock(slide, '技术架构', '平台技术架构', 'Platform architecture');

  const layerX = 1.0;
  const layerW = 10.3;
  const layers = [
    {
      y: TOP + 0.12,
      h: 1.14,
      title: 'Web 控制台（Next.js + Apollo）',
      body: '控制面 + 会话管理',
      foot: 'PostgreSQL（元数据 + 权限）',
      accent: GOLD,
    },
    {
      y: TOP + 1.84,
      h: 1.64,
      title: 'AI 编排服务（FastAPI）',
      body: 'Ask 编排 + Skill 调度',
      foot: 'deepagents Orchestrator / Isolated Skill Runner / PostgreSQL + pgvector（向量检索）',
      accent: ORANGE,
    },
    {
      y: TOP + 4.06,
      h: 0.98,
      title: 'SQL 语义引擎',
      body: '语义模型 + 多数据源执行',
      foot: '',
      accent: CYAN,
    },
  ];
  layers.forEach((layer) => {
    panel(slide, layerX, layer.y, layerW, layer.h, { color: CARD_ALT, lineColor: BORDER_STRONG, transparency: 0 });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: layerX + 0.18,
      y: layer.y + 0.16,
      w: 0.1,
      h: layer.h - 0.32,
      rectRadius: 0.03,
      fill: { color: layer.accent },
      line: { color: layer.accent },
    });
    addTextBox(slide, layer.title, layerX + 0.44, layer.y + 0.18, 4.8, { fontFace: FONT_HEAD, fontSize: 19, color: WHITE, bold: true, h: 0.26 });
    addTextBox(slide, layer.body, layerX + 0.44, layer.y + 0.52, 2.6, { fontFace: FONT_HEAD, fontSize: 10, color: GOLD, charSpace: 1.1, h: 0.16 });
    if (layer.foot) {
      addTextBox(slide, layer.foot, layerX + 0.44, layer.y + 0.76, 8.92, { fontSize: layer.h > 1.2 ? 13 : 12.6, color: MUTED, leading: 1.22 });
    }
  });

  slide.addShape(pptx.ShapeType.line, { x: 6.15, y: TOP + 1.26, w: 0, h: 0.58, line: { color: BORDER_STRONG, width: 1.6 } });
  slide.addShape(pptx.ShapeType.line, { x: 6.15, y: TOP + 3.48, w: 0, h: 0.58, line: { color: BORDER_STRONG, width: 1.6 } });
  [TOP + 1.78, TOP + 4.0].forEach((y) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: 6.08, y, w: 0.14, h: 0.14, fill: { color: GOLD }, line: { color: GOLD } });
  });

  infoCard(slide, {
    x: 11.56,
    y: TOP + 0.12,
    w: 1.3,
    h: 4.92,
    icon: iconSvg('workflow', GOLD),
    kicker: 'Planes',
    title: '三层解耦',
    titleSize: 14.2,
    body: '控制面、AI 编排与 SQL 执行三层解耦。',
    bodyY: TOP + 1.18,
    bodySize: 10.6,
  });

  footer(slide, 9);
  finalize(slide);
}

function buildScreens10() {
  const slide = pptx.addSlide();
  addBg(slide, 10);
  titleBlock(slide, '产品界面预览', '问数与知识库界面预览', 'Ask + knowledge base');
  screenshotCard(slide, X0, TOP, 5.72, 4.78, img('01 AI数据分析.png'), '问数界面', 'Ask experience');
  screenshotCard(slide, 6.84, TOP, 5.78, 4.78, img('01 知识库首页.png'), '知识库管理', 'Knowledge base home');
  footer(slide, 10);
  finalize(slide);
}

function buildScreens11() {
  const slide = pptx.addSlide();
  addBg(slide, 11);
  titleBlock(slide, '产品界面预览', '对话示例界面预览', 'Conversation demo');
  screenshotCard(slide, X0, TOP, 9.18, 4.88, img('对话示例.png'), '对话示例', 'Thread example');
  infoCard(slide, {
    x: 10.14,
    y: TOP,
    w: 2.68,
    h: 4.88,
    icon: iconSvg('workflow', GOLD),
    kicker: 'Interaction highlights',
    title: '多轮问答',
    bullets: [
      '自然语言追问与上下文延续。',
      '图表与结构化结果并存。',
      '回答链路可追踪到执行细节。',
    ],
    bodyY: TOP + 1.1,
    bodySize: 12.4,
  });
  footer(slide, 11);
  finalize(slide);
}

function buildScreens12() {
  const slide = pptx.addSlide();
  addBg(slide, 12);
  titleBlock(slide, '产品界面预览', '添加数据资产流程预览', 'Add data assets');
  screenshotCard(slide, X0, TOP, 5.72, 4.78, img('04 添加数据资产-1.png'), '添加数据资产（步骤一）', 'Select source / configure');
  screenshotCard(slide, 6.84, TOP, 5.78, 4.78, img('05 添加数据资产-2.png'), '添加数据资产（步骤二）', 'Preview / import');
  footer(slide, 12);
  finalize(slide);
}

function buildScreens13() {
  const slide = pptx.addSlide();
  addBg(slide, 13);
  titleBlock(slide, '产品界面预览', '知识资产配置界面预览', 'Knowledge assets configuration');
  screenshotCard(slide, X0, TOP, 5.72, 4.02, img('08 分析规则-1.png'), '分析规则管理', 'Analysis rules');
  screenshotCard(slide, 6.84, TOP, 5.78, 4.02, img('10 SQL 模板-1.png'), 'SQL 模板管理', 'SQL templates');
  panel(slide, X0, 6.18, 5.72, 0.66, { color: CARD, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, 'RULES', X0 + 0.22, 6.36, 0.56, { fontFace: FONT_HEAD, fontSize: 8.6, color: GOLD, charSpace: 1.1, h: 0.14 });
  addTextBox(slide, '把业务口径沉淀为规则，帮助模型保持一致解释。', X0 + 0.92, 6.34, 4.42, { fontFace: FONT_HEAD, fontSize: 12.4, color: WHITE, bold: true, h: 0.18 });
  panel(slide, 6.84, 6.18, 5.78, 0.66, { color: CARD, lineColor: BORDER_STRONG, transparency: 0 });
  addTextBox(slide, 'TEMPLATES', 7.08, 6.36, 0.82, { fontFace: FONT_HEAD, fontSize: 8.6, color: GOLD, charSpace: 1.1, h: 0.14 });
  addTextBox(slide, '用模板复用稳定查询模式，提升高频问题命中率。', 8.0, 6.34, 4.24, { fontFace: FONT_HEAD, fontSize: 12.4, color: WHITE, bold: true, h: 0.18 });
  footer(slide, 13);
  finalize(slide);
}

function buildTimeline() {
  const slide = pptx.addSlide();
  addBg(slide, 14);
  titleBlock(slide, '时间计划', 'V1 时间计划与里程碑', 'Roadmap and milestones');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.84,
    y: 5.92,
    w: 11.7,
    h: 0.12,
    rectRadius: 0.05,
    fill: { color: BORDER_STRONG },
    line: { color: BORDER_STRONG },
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.84,
    y: 5.92,
    w: 7.6,
    h: 0.12,
    rectRadius: 0.05,
    fill: { color: GOLD },
    line: { color: GOLD },
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.44,
    y: 5.92,
    w: 2.3,
    h: 0.12,
    rectRadius: 0.05,
    fill: { color: ORANGE },
    line: { color: ORANGE },
  });

  const phases = [
    ['演示平台搭建', '4 月', '部署演示环境，接入示例数据集并完成验证'],
    ['ROI 场景开发', '4 月', '基于演示环境开发 ROI 分析场景，输出可演示的完整流程'],
    ['香港联调测试', '5 月', '赴港与客户进行演示环境联调，收集反馈并完成问题修复'],
    ['生产部署验证', 'GPU 就绪后', '部署至生产环境，完成全流程验证'],
    ['正式上线', '验证通过后', '切换生产流量，平台正式上线'],
  ];
  phases.forEach((phase, idx) => {
    const x = 0.74 + idx * 2.37;
    const cardH = 3.12;
    panel(slide, x, 2.22, 2.18, cardH, {
      color: idx < 2 ? '202942' : CARD,
      lineColor: idx < 2 ? GOLD : BORDER_STRONG,
      transparency: 0,
    });
    tag(slide, phase[1], x + 0.2, 2.42, { fill: idx < 3 ? GOLD : ORANGE, textColor: BG0, w: phase[1].length > 5 ? 0.92 : 0.74 });
    addTextBox(slide, phase[0], x + 0.2, 2.82, 1.78, { fontFace: FONT_HEAD, fontSize: 15.4, color: WHITE, bold: true, leading: 1.08 });
    addTextBox(slide, phase[2], x + 0.2, 3.46, 1.78, { fontSize: 11.4, color: MUTED, leading: 1.3 });
    slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.96, y: 5.84, w: 0.24, h: 0.24, fill: { color: idx < 3 ? GOLD : ORANGE }, line: { color: idx < 3 ? GOLD : ORANGE } });
  });

  footer(slide, 14);
  finalize(slide);
}

async function main() {
  buildCover();
  buildPositioning();
  buildProductStructure();
  buildKnowledgeBase();
  buildAskFlow();
  buildSkillSlide();
  buildNl2Sql();
  buildAuth();
  buildArchitecture();
  buildScreens10();
  buildScreens11();
  buildScreens12();
  buildScreens13();
  buildTimeline();
  await pptx.writeFile({ fileName: outputFile });
  console.log(`Wrote ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

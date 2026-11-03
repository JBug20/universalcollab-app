'use strict';
// Appearance themes (1.2.0). Settings → Appearance. The app's stylesheets use many fixed colours, so a theme
// recolours them where they are: each colour in portal.css, studio-ui-v2.css and integrated-assist.css is changed by
// the theme's rule (shift the purples to another hue, invert light and dark, and so on). Status colours (red,
// yellow, green) keep their meaning. Only the app's own look changes: the stream, previews, video, platform logos
// and saved layouts are never touched. Loaded in <head> after the stylesheets so the theme applies before the
// first paint.
(() => {
  const THEMES = {
    purple: { name: 'Dark purple (default)' },
    blue: { name: 'Midnight blue', hue: 212 },
    teal: { name: 'Teal', hue: 172 },
    graphite: { name: 'Graphite (neutral grey, orange accent)', graphite: true },
    contrast: { name: 'High contrast', contrast: true },
    light: { name: 'Light', light: true }
  };

  const hsl = ([r, g, b]) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min,
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const rgb = ([h, s, l]) => {
    h = (((h % 360) + 360) % 360) / 360;
    if (!s) return [l, l, l].map(v => Math.round(v * 255));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
      p = 2 * l - q;
    const f = t => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
  };
  // Purple and violet, including the faintly purple dark greys of the panels.
  const purplish = (h, s) => h >= 235 && h <= 320 && s > 0.04;
  const clamp = v => Math.max(0, Math.min(1, v));

  // One colour (r, g, b) through a theme.
  function transform(c, theme) {
    const t = THEMES[theme];
    if (!t || theme === 'purple') return c;
    let [h, s, l] = hsl(c);
    if (t.hue !== undefined) {
      if (purplish(h, s)) h = t.hue + (h - 265) * 0.5;
    } else if (t.graphite) {
      if (purplish(h, s)) {
        if (s > 0.35 && l > 0.3) h = 24;
        else s *= 0.12;
      }
    } else if (t.contrast) {
      const accent = purplish(h, s) && s > 0.35 && l > 0.3;
      if (accent) [h, s, l] = [48, 1, Math.max(l, 0.55)];
      else if (l < 0.22) [s, l] = [s * 0.3, l * 0.35];
      // Only neutral greys change: text brighter, borders lighter. Red, yellow and green keep their colour.
      else if (s < 0.3 && l > 0.6) l = Math.max(l, 0.93);
      else if (s < 0.3) l = 0.72;
    } else if (t.light) {
      // Pure black is where video and previews are shown (letterboxing): it stays black.
      if (l < 0.02 && s < 0.05) return c;
      // Light and dark swap; colours keep their hue. Very light text becomes near-black.
      l = 1 - l;
      if (purplish(h, s) && s > 0.35) l = clamp(l * 0.9);
    }
    return rgb([h, clamp(s), clamp(l)]);
  }

  const HEX = /#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
  const RGB =
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;
  const hex2 = n => n.toString(16).padStart(2, '0');
  // Every colour in a CSS value (hex, rgb(), rgba()) through a theme; anything else unchanged.
  function recolour(value, theme) {
    if (!value || theme === 'purple') return value;
    return value
      .replace(HEX, (m, x) => {
        const full = x.length <= 4 ? [...x].map(c => c + c).join('') : x;
        const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
        const a = full.length === 8 ? full.slice(6) : '';
        return '#' + transform([r, g, b], theme).map(hex2).join('') + a;
      })
      .replace(RGB, (m, r, g, b, a) => {
        const [R, G, B] = transform([+r, +g, +b], theme);
        return a === undefined ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${a})`;
      });
  }

  const api = { THEMES, transform, recolour };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  window.appTheme = api;

  const KEY = 'uc-theme';
  const FILES = /(^|\/)(portal|studio-ui-v2|integrated-assist)\.css$/;
  // Pages loaded from files cannot read their own stylesheets, so the main process hands over the text of the
  // app's three stylesheets (theme-styles in main.cjs). A theme builds recoloured copies and uses them instead of
  // the originals; the default theme simply switches the originals back on.
  let sources = null;
  function originalsOn(on) {
    for (const link of document.querySelectorAll('link[rel=stylesheet]'))
      if (FILES.test(link.getAttribute('href') || '') && link.sheet) link.sheet.disabled = !on;
  }
  function rules(list, out = []) {
    for (const r of list) {
      if (r.style) out.push(r);
      if (r.cssRules) rules(r.cssRules, out);
    }
    return out;
  }
  function themed(text, theme) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    for (const rule of rules(sheet.cssRules))
      for (const prop of [...rule.style]) {
        const v = rule.style.getPropertyValue(prop),
          priority = rule.style.getPropertyPriority(prop);
        if (prop === 'color-scheme') {
          if (THEMES[theme].light) rule.style.setProperty(prop, 'light', priority);
        } else if (/#[0-9a-f]{3}|rgba?\(/i.test(v))
          rule.style.setProperty(prop, recolour(v, theme), priority);
      }
    return sheet;
  }
  function apply(theme) {
    if (!THEMES[theme]) theme = 'purple';
    if (theme === 'purple') {
      document.adoptedStyleSheets = [];
      originalsOn(true);
    } else {
      try {
        sources ||= window.relayDesktop?.themeStyles?.() || null;
      } catch {}
      if (!sources?.length) return 'purple';
      document.adoptedStyleSheets = sources.map(f => themed(f.text, theme));
      originalsOn(false);
    }
    document.documentElement.dataset.theme = theme;
    return theme;
  }
  let current = 'purple';
  try {
    current = localStorage.getItem(KEY) || 'purple';
  } catch {}
  current = apply(current);
  window.appTheme.current = () => current;
  window.appTheme.set = theme => {
    current = apply(theme);
    for (const r of document.querySelectorAll('input[name=appTheme]')) r.checked = r.value === current;
    try {
      localStorage.setItem(KEY, current);
    } catch {}
    return current;
  };

  // Settings → Appearance: the theme list (built once the page is there).
  window.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('appearanceSettings');
    if (!box) return;
    const list = document.createElement('div');
    list.className = 'theme-list';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Theme');
    for (const [id, t] of Object.entries(THEMES)) {
      const label = document.createElement('label');
      label.className = 'check-row theme-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'appTheme';
      input.value = id;
      input.checked = id === current;
      input.onchange = () => window.appTheme.set(id);
      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      // Drawn directly (not from the stylesheet the current theme recolours): background, panel and accent.
      swatch.style.background = `linear-gradient(135deg, ${recolour('#101017', id)} 0 40%, ${recolour('#302741', id)} 40% 70%, ${recolour('#ae86fb', id)} 70%)`;
      swatch.style.borderColor = recolour('#464050', id);
      label.append(input, swatch, document.createTextNode(' ' + t.name));
      list.append(label);
    }
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Themes change only how UniversalCollab looks on this PC. Your stream, previews and saved layouts stay exactly the same.';
    const [, ...rest] = box.children;
    for (const n of rest) if (n.tagName === 'P') n.remove();
    box.querySelector('h2').after(list, hint);
  });
})();

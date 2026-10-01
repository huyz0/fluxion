// The browser side of record-metrics.mjs: runs in the page (not in Node), measures in the DOM and
// leaves `window.fluxionRecordFonts`. Plain script, no imports: Playwright injects it as it is.

/** The widths, and heights, the DOM gives `texts` set in the CSS `font`, all in one layout. */
function boxes(texts, font) {
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:0;top:0;white-space:pre;line-height:1.2;font:${font}`;
  const spans = texts.map((text) => {
    const span = document.createElement('span');
    span.style.cssText = 'display:block;width:max-content';
    span.textContent = text;
    box.append(span);
    return span;
  });
  document.body.append(box);
  const sizes = spans.map((span) => span.getBoundingClientRect());
  box.remove();
  return sizes;
}

const widthsOf = (texts, font) => boxes(texts, font).map((b) => b.width);

/** Every sequence of `size` characters taken from `characters`. */
function sequences(characters, size) {
  const chars = [...characters];
  let out = [''];
  for (let i = 0; i < size; i++) out = out.flatMap((prefix) => chars.map((c) => prefix + c));
  return out;
}

/** The units a sequence's measured width adds beyond `parts` (the sum of what it is made of), when it adds any. */
const addedBeyond = (measured, parts) => (Math.abs(measured - parts) > 0.5 ? measured - parts : undefined);

/** The advance of every character of `alphabet`. */
function recordAdvances(alphabet, font) {
  const chars = [...alphabet];
  const widths = widthsOf(chars, font);
  return Object.fromEntries(chars.map((c, i) => [c, widths[i]]));
}

/** What every two-character sequence of `paired` adds to its two advances. */
function recordPairs(paired, advances, font) {
  const list = sequences(paired, 2);
  const widths = widthsOf(list, font);
  const pairs = {};
  list.forEach((ab, i) => {
    const [a, b] = [...ab];
    const added = addedBeyond(widths[i], advances[a] + advances[b]);
    if (added !== undefined) pairs[ab] = added;
  });
  return pairs;
}

/** What every three-letter sequence of `letters` adds to its three advances and its two pairs. */
function recordTriples(letters, advances, pairs, font) {
  const list = sequences(letters, 3);
  const widths = widthsOf(list, font);
  const triples = {};
  list.forEach((abc, i) => {
    const [a, b, c] = [...abc];
    const parts = advances[a] + advances[b] + advances[c] + (pairs[a + b] ?? 0) + (pairs[b + c] ?? 0);
    const added = addedBeyond(widths[i], parts);
    if (added !== undefined) triples[abc] = added;
  });
  return triples;
}

/** Load a face from its base64 bytes. */
async function load(f) {
  const face = new FontFace(f.family, `url(data:font/woff2;base64,${f.data})`, { weight: String(f.weight), style: f.style });
  document.fonts.add(await face.load());
}

/** The metrics of one font. */
function recordFace(f, args) {
  const font = `${f.style} ${f.weight} ${args.units}px/1.2 ${f.family}`;
  const advances = recordAdvances(args.alphabet, font);
  const pairs = recordPairs(args.paired, advances, font);
  const triples = recordTriples(args.letters, advances, pairs, font);
  return { family: f.family, weight: f.weight, style: f.style, unitsPerEm: args.units, advances, defaultAdvance: advances['?'], pairs, triples };
}

/** The DOM size of every text in every variant. */
function recordSamples(args) {
  return args.variants.flatMap((v) => {
    const sizes = boxes(args.texts, `${v.weight} ${v.size}px/1.2 Roboto`);
    return args.texts.map((text, i) => ({ text, size: v.size, weight: v.weight, width: sizes[i].width, height: sizes[i].height }));
  });
}

window.fluxionRecordFonts = async (args) => {
  for (const f of args.fonts) await load(f);
  await document.fonts.ready;
  return { faces: args.fonts.map((f) => recordFace(f, args)), samples: recordSamples(args), userAgent: navigator.userAgent };
};

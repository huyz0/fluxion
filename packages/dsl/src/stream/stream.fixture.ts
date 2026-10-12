// Multi-screen FluxScript texts for the streaming tests: the checkout example, and small files in the layouts the splitter must read.
import { CHECKOUT } from '../read/checkout.fixture.js';

const SCREENS_AT_ZERO = `flux: 1
title: Flat
uses: [basic]
screens:
- id: one
  title: One
  nodes:
    a: { shape: rect, label: A }
    b: { shape: rect, label: B }
  edges:
  - a -> b
- id: two
  title: Two
  nodes:
    c: { shape: rect, label: C }
`;

const COMMENTS_AND_BLANKS = `# a deck
flux: 1
title: Noted   # trailing comment
uses: [basic]

screens:   # the screens

  # first
  - id: one
    notes: |
      - id: not-a-screen
        still the note
    nodes:
      a: { shape: rect }

  # second, after a blank line

  - id: two
    nodes:
      b: { shape: rect }
      c: { shape: rect }
    edges:
      - b -> c: "- id: x"
`;

const DEEP_INDENT = `flux: 1
uses: [basic]
screens:
    - id: one
      nodes:
          a: { shape: rect }
    - id: two
      nodes:
          b: { shape: rect }
`;

const WITH_TAIL = `flux: 1
uses: [basic]
screens:
  - id: one
    nodes:
      a: { shape: rect }
  - id: two
    nodes:
      b: { shape: rect }
settings: { autoplay: false }
`;

/** CRLF line ends, no newline at the end of the file. */
const CRLF =
  'flux: 1\r\nuses: [basic]\r\nscreens:\r\n  - id: one\r\n    nodes:\r\n      a: { shape: rect }\r\n  - id: two\r\n    nodes:\r\n      b: { shape: rect }';

/** The texts the streaming tests run over, by name. */
export const STREAM_TEXTS: { readonly [name: string]: string } = {
  checkout: CHECKOUT,
  'screens at column 0': SCREENS_AT_ZERO,
  'comments, blanks and a dashed note': COMMENTS_AND_BLANKS,
  'four-space indent': DEEP_INDENT,
  'a key after the screens': WITH_TAIL,
  crlf: CRLF,
};

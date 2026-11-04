// The Arrows pack's connector types (FR-CON-010, M18.250): the five decorations over the orthogonal router. They travel in the
// pack's `connectors.json` (ADR-0048) and in `arrowsPack.connectors`; a host registers them in its routers.
import type { ConnectorDef } from '@fluxion/sdk';

/** The five connector types, in id order. */
export const connectors: readonly ConnectorDef[] = [
  {
    id: 'arrows:cable',
    router: 'orthogonal',
    decoration: { kind: 'cable', pitch: 10 },
    name: 'Cable',
    describe: 'A tied cable, for a physical wired link.',
    keywords: ['wire', 'wired', 'physical'],
    defaultStyle: { stroke: { width: 2 } },
  },
  {
    id: 'arrows:double',
    router: 'orthogonal',
    decoration: { kind: 'double', gap: 3 },
    name: 'Double',
    describe: 'Two parallel lines, for a redundant or high-capacity link.',
    keywords: ['parallel', 'redundant'],
  },
  {
    id: 'arrows:pipe',
    router: 'orthogonal',
    decoration: { kind: 'pipe', wall: 1.5 },
    name: 'Pipe',
    describe: 'A hollow pipe, for a data or fluid pipeline.',
    keywords: ['pipeline', 'tube'],
  },
  {
    id: 'arrows:wavy',
    router: 'orthogonal',
    decoration: { kind: 'wavy', amplitude: 3, wavelength: 12 },
    name: 'Wavy',
    describe: 'A wavy line, for a loose or wireless link.',
    keywords: ['wave', 'wireless', 'loose'],
  },
  {
    id: 'arrows:zigzag',
    router: 'orthogonal',
    decoration: { kind: 'zigzag', amplitude: 3, wavelength: 8 },
    name: 'Zigzag',
    describe: 'A zigzag line, for an electrical or unstable link.',
    keywords: ['electric', 'unstable'],
  },
];

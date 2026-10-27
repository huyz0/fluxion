// A pack's connectors.json (FR-CON-010): the five decorations over the orthogonal router, for pack-connectors.test.ts.
export const CONNECTOR_DEFS: { readonly format: string; readonly formatVersion: string; readonly definitions: readonly Record<string, unknown>[] } = {
  format: 'fluxion-connector-defs',
  formatVersion: '1.0',
  definitions: [
    {
      id: 'lines:wavy',
      router: 'orthogonal',
      decoration: {
        kind: 'wavy',
        amplitude: 3,
        wavelength: 12,
      },
      name: 'Wavy',
      describe: 'A wavy line, for a loose or wireless link.',
    },
    {
      id: 'lines:zigzag',
      router: 'orthogonal',
      decoration: {
        kind: 'zigzag',
        amplitude: 3,
        wavelength: 8,
      },
      name: 'Zigzag',
      describe: 'A zigzag line, for an electrical or unstable link.',
    },
    {
      id: 'lines:double',
      router: 'orthogonal',
      decoration: {
        kind: 'double',
        gap: 3,
      },
      name: 'Double',
      describe: 'Two parallel lines, for a redundant or high-capacity link.',
    },
    {
      id: 'lines:pipe',
      router: 'orthogonal',
      decoration: {
        kind: 'pipe',
        wall: 1.5,
      },
      name: 'Pipe',
      describe: 'A hollow pipe, for a data or fluid pipeline.',
    },
    {
      id: 'lines:cable',
      router: 'orthogonal',
      decoration: {
        kind: 'cable',
        pitch: 10,
      },
      name: 'Cable',
      describe: 'A tied cable, for a physical wired link.',
      defaultStyle: {
        stroke: {
          width: 2,
        },
      },
    },
  ],
};

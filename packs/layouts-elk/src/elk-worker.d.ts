// elkjs's minified worker build has no types of its own; the pack reads only its fake worker (engine.ts).
declare module 'elkjs/lib/elk-worker.min.js' {
  const mod: unknown;
  export = mod;
}

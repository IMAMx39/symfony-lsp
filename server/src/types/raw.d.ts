// `?raw` imports are inlined as strings by Vite (tests) and by scripts/build.mjs (bundle).
declare module '*?raw' {
  const content: string;
  export default content;
}

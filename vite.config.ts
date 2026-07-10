import { defineConfig } from 'vite';

// GitHub Pages(Project Pages)部署在子路徑 /beat-typer/;
// dev(serve)維持根路徑 '/',讓 playtest-highway 技能照舊用 http://localhost:5173/ 開遊戲。
// 資源載入已用 import.meta.env.BASE_URL 前綴(見 src/loader/builtin.ts),會自動跟著 base。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/beat-typer/' : '/',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));

import { defineConfig } from "vite-plus";

// No React plugin: the build compiles JSX on its own, with the automatic runtime
// that tsconfig.json asks for ("jsx": "react-jsx").
export default defineConfig({});

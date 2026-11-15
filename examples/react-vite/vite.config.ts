// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite-plus";

// No React plugin: the build compiles JSX on its own, with the automatic runtime
// that tsconfig.json asks for ("jsx": "react-jsx").
export default defineConfig({});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'reference', plugins: [react()], resolve: { preserveSymlinks: true }, optimizeDeps: { noDiscovery: true, include: [] }, build: { outDir: '../dist', emptyOutDir: true } });

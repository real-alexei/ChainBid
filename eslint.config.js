import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // hardhat build output: artifacts, the TypeChain bindings, ignition state
      '**/artifacts/**',
      '**/cache/**',
      'contracts/types/**',
      'contracts/ignition/deployments/**',
      // introspected from the migrated database
      'packages/db/src/schema.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])

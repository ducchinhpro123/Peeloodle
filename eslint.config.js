import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig([
	includeIgnoreFile(gitignorePath),
	// React-era proof harness imported from the source repository: kept byte-identical
	// to what it proved, so it is neither reformatted nor linted here.
	{ ignores: ['proofs/**'] },
	js.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } }
	},

	{
		// TypeScript modules: parse with the TS parser and use its type-aware
		// no-unused-vars instead of the core rule, which misreads type-only names.
		files: ['**/*.ts'],
		languageOptions: { parser: tseslint.parser },
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: {
			'no-unused-vars': 'off',
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},

	{
		files: ['**/*.svelte', '**/*.svelte.js'],
		languageOptions: { parserOptions: {} }
	},

	{
		rules: {
			// This app never configures `paths.base`, so plain absolute app links are
			// already correct; route adapters call `goto()` with the same paths.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
]);

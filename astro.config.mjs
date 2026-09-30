// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Knowledge',
			components: {
				PageTitle: './src/components/PageTitle.astro',
			},
			routeMiddleware: './src/routeData.ts',
			head: [
				{
					tag: 'meta',
					attrs: {
						name: 'robots',
						content: 'noindex, nofollow',
					},
				},
			],
		}),
	],
});

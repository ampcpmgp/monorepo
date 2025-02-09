import type { AstroIntegration } from "astro";
import { paraglideVitePlugin, type CompilerArgs } from "@inlang/paraglide-js";
import path from "node:path";
import { alias } from "./alias.js";
import { fileURLToPath } from "node:url";
import { nodeNormalizePath } from "./utilts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const middlewarePath = path.join(__dirname, "middleware.js");

export function integration(args: CompilerArgs): AstroIntegration {
	return {
		name: "paraglide",
		hooks: {
			"astro:config:setup": async ({
				addMiddleware,
				updateConfig,
				injectScript,
			}) => {
				//Register the middleware
				addMiddleware({
					order: "pre", //Run before user-defined middleware (why not?)
					entrypoint: middlewarePath,
				});

				const runtimePath = path.resolve(
					process.cwd(),
					args.outdir,
					"runtime.js",
				);

				//Register the vite plugin
				updateConfig({
					vite: {
						plugins: [
							paraglideVitePlugin(args),
							alias({
								//normalizing the path is very important!
								//otherwise you get duplicate modules on windows
								//learned that one the hard way (parjs-47)
								"virtual:paraglide-astro:runtime":
									nodeNormalizePath(runtimePath),
							}),
						],
					},
				});

				injectScript(
					"before-hydration",
					`
          import { isLocale, defineGetLocale, defineSetLocale, baseLocale } from "virtual:paraglide-astro:runtime";
					import { getPathByLocale, getLocaleByPath } from "astro:i18n";

					function splitPathByLocale(path) {
						const [maybeLocale, ...rest] = path.split('/').filter(Boolean);
						const locale = isLocale(maybeLocale) ? maybeLocale : baseLocale;
						return [locale, rest.join('/')];
				  }
					
					defineGetLocale(() => {
						const [locale] = splitPathByLocale(window.location.pathname);
						return locale;
					});

					defineSetLocale((newLocale) => {
						const [locale, path] = splitPathByLocale(window.location.pathname);
						const redirectTo = getPathByLocale(newLocale, path);

						// the astro getPathByLocale function is buggy and returns the baseLocale as path
						if (redirectTo.replaceAll("/", "") === baseLocale){
							window.location = '/';
						} else {
							window.location = redirectTo;
						}
					})
                    `,
				);

				return undefined;
			},
		},
	};
}

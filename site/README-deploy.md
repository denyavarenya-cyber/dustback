# Deploying dustback.app

The site is plain static files — no build step. On Cloudflare Pages either drag-and-drop this `site/` folder in the dashboard (Workers & Pages → Create → Pages → Upload assets), or connect the git repository and set the build output directory to `site` with no build command. Then add the custom domain `dustback.app` under the project's Custom domains tab and Cloudflare handles TLS automatically.

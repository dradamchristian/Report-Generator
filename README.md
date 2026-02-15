# RCPath NLP Reporter (starter)

Public Netlify site that turns a one-line natural language description into a plain-text report.

## Quick start (GitHub → Netlify)
1. Create a new GitHub repo and upload this folder contents.
2. In Netlify: **Add new site → Import from Git** → select your repo.
3. Ensure Netlify build settings run `npm ci` (included in netlify.toml).
4. Set an environment variable in Netlify:
   - `OPENAI_API_KEY` = your OpenAI API key
   - Optional: `OPENAI_MODEL` = e.g. `gpt-4o-mini` (default)
4. Deploy.

## Local dev
- Install Netlify CLI (optional) and run:
  - `npm install`
  - `npx netlify dev`

If you don't use Netlify CLI, you can still open `index.html`, but functions won't work.

## Adding a new dataset
Add a folder under `/datasets/<dataset_id>/` with:
- `schema.json`
- `rules.json`
- `template.txt`

Then add an entry to `datasets/manifest.json`.

## Notes
- Report output is plain text for copy/paste.
- "Caveats" appear in a separate box and are not included in the report text.


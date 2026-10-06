# Clauditorium

Turn any HTML file Claude generates into a link you can share.

<img width="960" height="480" alt="image" src="https://github.com/user-attachments/assets/68e8fbd7-230c-4095-bbc1-b84ebb8af93c" />


Drop the file into a folder, push, send the URL. No build step, no backend, no dependencies. Three static files on GitHub Pages.

```
https://<user>.github.io/<repo>/clauditorium/?page=example
```

## Why

Claude produces good HTML decks, prototypes and one-pagers. Getting them in front of other people is the awkward part: you end up sending a `.html` attachment, a screenshot, or a link that lives in someone else's product.

Clauditorium hosts them yourself instead:

- **A stable link per page.** Push a new version of the file and the URL stays the same.
- **Viewers need nothing.** No Claude account, no install, no login. A browser is enough.
- **Your repo, your domain.** Every page is a file in git, so you get history, review and rollback for free. Add a custom domain if you want one.
- **Access control where your plan allows it.** On GitHub Enterprise Cloud, Pages can be restricted to people with access to the repo, which makes this usable for internal material. On every other plan the site is public. See [Privacy](#privacy).
- **Nothing to maintain.** About 20 lines of JavaScript and 2 lines of CSS.

It works for any self-contained HTML file, not only Claude's.

## How it works

`index.html` is a full-screen iframe. `shell.js` reads the `page` query parameter and loads `pages/<page>.html` into it.

```
clauditorium/
├── README.md
├── how-it-works.svg
├── index.html
├── shell.css
├── shell.js
└── pages/
    ├── example.html
    └── q3-roadmap.html
```

Try it: [`?page=example`](https://alexsyna.github.io/awesome-pm-tools/clauditorium/?page=example)

## Setup

### 1. Copy the files

Copy the `clauditorium/` folder into your own repository (or fork this one). Keep `index.html`, `shell.css`, `shell.js` and the `pages/` folder together. `pages/` ships with `example.html`, which you can delete once you have added your own page.

### 2. Enable GitHub Pages

1. Open the repository on GitHub and click **Settings**.
2. In the sidebar, under "Code and automation", click **Pages**.
3. Under "Build and deployment" → "Source", select **Deploy from a branch**.
4. Pick the branch (`main`) and the folder (`/ (root)`).
5. Click **Save**.

The first deploy takes a minute or two. Progress is in the **Actions** tab, and the site URL appears at the top of the Pages settings once it is live.

Branch deploys can only publish from the repository root or a `/docs` folder. That is fine: with the root as source, the shell is served at `/<repo>/clauditorium/`.

Pages is available for public repositories on GitHub Free, and for private repositories on Pro, Team and Enterprise.

### 3. Add a page

1. Ask Claude for a **single self-contained HTML file** (CSS and JavaScript inline, no local asset paths).
2. Save it as `clauditorium/pages/<name>.html`. Use lowercase and hyphens, no spaces.
3. Commit and push.

### 4. Share the link

```
https://<user>.github.io/<repo>/clauditorium/?page=<name>
```

`<name>` is the filename without `.html`.

## Updating a page

Overwrite the file in `pages/` and push. The link does not change. Pages caches for a few minutes, so a hard refresh (Cmd/Ctrl+Shift+R) may be needed to see the new version straight away.

## Privacy

**A GitHub Pages site is public on the internet, even when the repository is private.** Anyone with the link can open the page, and a public repo also exposes the source file.

Do not publish confidential material unless your organization is on GitHub Enterprise Cloud and has set the Pages site visibility to private.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No page selected" | The URL has no `?page=` parameter | Add `?page=<name>` |
| 404 inside the frame | Filename does not match, or the deploy has not finished | Check the name (case-sensitive, no `.html` in the URL) and the Actions tab |
| Page is tiny, top-left corner | `shell.css` did not load | Check the `<link>` path in `index.html` |
| Old version still showing | Browser or CDN cache | Hard refresh. After editing `shell.js` or `shell.css`, bump the `?v=` number in `index.html` |
| Images or styles missing in the page | The HTML references local files | Regenerate as a single self-contained file, or put the assets in `pages/` |

## Limitations

- No index of pages. You need to know the page name.
- No comments, analytics or password protection.
- Links inside a page navigate within the frame, so the address bar keeps showing the shell URL.

## License

Apache-2.0

Clauditorium is an independent project and is not affiliated with or endorsed by Anthropic.

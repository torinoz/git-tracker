# Git Tracker

A private web page that shows which of your GitHub repositories are **shared with someone** and which are **not**. It runs entirely in your browser. There's no server and nothing to install.

## Open it

Open `index.html` in your browser (double-click it), or visit wherever it's hosted.
The first time, it asks for a GitHub key. Follow the steps on screen (about a minute).

## What it shows

- **Shared**: at least one other person has access, with their role (read, write, admin, and so on).
- **Invite pending**: you invited someone who hasn't accepted yet.
- **Not shared**: only you have access.
- Each repository is also labelled Private or Public. Anyone can *view* a public repo, but only collaborators can change it.
- **Sharing changes over time**: every refresh compares against the last check and logs who was added or removed.
- **Manage access** opens that repository's access settings on GitHub.

It covers repositories owned by your personal account. It only reads from GitHub and never changes anything.

## Privacy

- Your key is saved only in your browser and is only ever sent to `api.github.com`. The page is locked so it can't contact anything else.
- Without your key, the page shows only the Connect screen. Nobody who opens it can see your repositories.
- **Disconnect** removes the key and history from that browser. To cancel the key completely, delete it at https://github.com/settings/tokens.

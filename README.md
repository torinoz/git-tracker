# Git Tracker

A private app that runs only on your computer and shows which of your GitHub repositories are **shared with someone** and which are **not**.

## Start it

Double-click **`Start Git Tracker.bat`**. Your browser opens at http://127.0.0.1:4517.
Keep the black window open while you use it. Closing it stops the app.

The first time, it asks for a GitHub token. Follow the steps on screen (it takes about a minute).

## What it shows

- **Shared**: at least one other person has access (with their role: read, write, admin, and so on).
- **Invite pending**: you invited someone who hasn't accepted yet.
- **Not shared**: only you have access.
- Each repository is also labelled Private or Public (public repos can be *viewed* by anyone, but only collaborators can change them).
- **Sharing changes over time**: every Refresh compares against the previous check and logs who was added or removed.
- **Manage access** opens that repository's access settings on GitHub.

It covers repositories owned by your personal account. It only reads from GitHub and never changes anything.

## Privacy

- The app listens only on `127.0.0.1`, so other computers (including others on your Wi-Fi) can't open it.
- Your token is stored in `data/config.json` on this PC. Don't share that folder.
- **Disconnect** deletes the saved token and history. To revoke the token completely, delete it at https://github.com/settings/tokens.

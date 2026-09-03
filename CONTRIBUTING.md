# Contributing to usertypo_

Thanks for helping improve usertypo_.

## Before you start

1. Fork the repo on GitHub, then clone **your** fork.
2. Copy `.env.example` to `.env` and use **your own** Clerk/Supabase projects for local work. Do not ask maintainers for production secret keys.
3. Run `npm ci` then `npm run dev`.
4. Optional local workers: `npm run worker:multiplayer:dev` and `npm run worker:leaderboards:dev`.

## Making changes

1. Create a branch from `main` for your change.
2. Keep PRs focused — one feature or fix per PR when possible.
3. If you edit files under `pages/`, run `npm run build:pages` so `js/page-fragments.js` stays in sync.
4. Run `npm test` when your change touches logic covered by tests.

## Pull requests

1. Push your branch to your fork.
2. Open a Pull Request against `usertypo/usertypo` → `main`.
3. Describe **what** changed and **why**.
4. Wait for review; maintainers merge when ready.

You cannot push directly to `main` on the upstream repo unless you are added as a collaborator.

## License

By contributing, you agree that your contributions are licensed under the same
[GNU Affero General Public License v3.0](./LICENSE) (AGPLv3) as the project.

## Never paste secrets

Do **not** put any of the following in issues, PR descriptions, screenshots, or commits:

- Clerk secret keys (`sk_…`)
- Supabase `service_role` keys
- Resend / Web3Forms / other API keys
- Real `.env` files

If you accidentally commit a secret, rotate it immediately in the provider dashboard and tell a maintainer.

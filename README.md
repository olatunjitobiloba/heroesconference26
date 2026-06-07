# Heroes Conference '26 Raffle

Audience URL after deployment:

```text
https://heroesconference26.vercel.app
```

Admin URL after deployment:

```text
https://heroesconference26.vercel.app/admin
```

## Local Checks

```bash
npm run check
```

## Vercel Deploy

The app needs two runtime environment variables:

```bash
ADMIN_PIN=<six-digit pin>
ADMIN_TOKEN=<random private token>
```

The generated values for this machine are stored outside the repository at:

```text
../work/deployment-secrets.txt
```

Once Vercel CLI auth is active:

```bash
vercel deploy --prod --yes --name heroesconference26 --env ADMIN_PIN=<pin> --env ADMIN_TOKEN=<token>
```

The audience page polls the live API and animates whenever the admin starts a draw. The admin page requires the PIN before it can draw, reset, or change settings.

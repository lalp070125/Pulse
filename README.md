# Pulso — Machine Control Studio

Design a machine's control logic, run it in simulation, watch it, test it, build its operator
panel and check it on a 3D twin. The full specification is in [`SPEC.md`](SPEC.md); the standing
rules for building it are in [`CLAUDE.md`](CLAUDE.md).

## Run it

```bash
npm install        # once (the Codespace does this for you)
npm run dev        # starts everything on port 4600
```

Open the forwarded port **4600 ("Pulso")** from the Codespace _Ports_ tab. The app opens at
`/studio`; `/panel` and `/twin` are the other two apps.

| Command           | What it does                                 |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Development server on port 4600, live reload |
| `npm run build`   | Builds the UI for production                 |
| `npm start`       | Serves the built UI on port 4600             |
| `npm run check`   | Type check, lint and unit tests              |
| `npm run test:ui` | Browser smoke tests (Playwright)             |

## Safety statement

Pulso is **not** a safety system and must never be the only thing preventing harm. Emergency
stops, guard interlocks and any function protecting people must be implemented with hardwired,
certified safety components, independent of this software. This also applies to any future
hardware driver.

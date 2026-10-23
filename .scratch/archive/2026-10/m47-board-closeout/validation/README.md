# M-47 board close-out — validation images

Two images from the M-7 role-editor journey, captured by the extended
`scripts/team-ui.e2e.ts` case `opens an Agent from the roster and reads its
Runs tab in real Web` (the role-select segment). They close M-7's screenshot
acceptance item: the role editor at the desktop width and at 390×844.

| Filename | Acceptance point | Producing case / artifact | Rerun command |
| --- | --- | --- | --- |
| `agent-role-editor.png` | The role select renders in the add-Agent dialog at 1440×960 with the chosen role (`worker`). | `scripts/team-ui.e2e.ts` → `opens an Agent from the roster and reads its Runs tab in real Web`; source artifact `artifacts/browser/agent/agent-role-editor.png` (gitignored). | `CHROME_PATH=<chrome> node scripts/run-browser-test.mjs` (after `npm run build` and the Harness's `pnpm build:lib && pnpm build:native-system && pnpm build:web`). |
| `agent-role-editor-390.png` | The same dialog at 390×844: the role select's box ends inside the 390px viewport (asserted by bounding box in the case). | Same case; source artifact `artifacts/browser/agent/agent-role-editor-390.png` (gitignored). | Same command. |

The same case also asserts the role pill on the roster row at both widths
(`data-member-role` count 1 at 1440 and at 390).

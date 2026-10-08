# QA03 REL03 plus low-height CSS build and isolated UI, 2026-09-28

MGR02 granted an exclusive c19 build window after REL03 and the low-height CSS single-file protected sync. Input: HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, status 110, REL03 32/32 snapshot SHA match, CSS SHA256 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`, sync receipt SHA256 `6F76ABAFEE75BFFE219F3E1646A17296989B39D96D7D59D7F56B48F3955E0EE8`.

The old Python fingerprint launcher returned exit 9009 before writing any manifest; its raw output and exit are retained. The replacement external Node fingerprint script completed, producing `before-node.json` SHA256 `47445D60F308439E1CB6E8E23B665071C061EB70B4CFB361DDA0C87A7808854A` with source 113/dist 78.

| Gate | Result |
| --- | --- |
| `pnpm --filter @aijian/studio-web typecheck` | exit 0 |
| `pnpm --filter @aijian/desktop typecheck` | exit 0 |
| `pnpm --filter @aijian/studio-web build` | exit 0 |
| `pnpm --filter @aijian/desktop build` | exit 0 |
| Built-CSS isolated Edge DOM at 1424×720 and 1424×881 | both PASS; excerpt height 136/187 px; status/buttons inside preview and both button clicks work |
| Frozen old Panel component with QA01's real CONSUMED receipt | 1/1 PASS for observed manual behavior: mount GET 0, button-driven original GET 1 and approval GET 1, approval POST 0 |

`after-node.json` SHA256 `0BE9ED4DA07E85BBBB959B2FFE6BDEFB5B031D0C8F67A0746532FEFD708F9291` records source 113/dist 82. `compare.json` SHA256 `5EF43337CBB9E90AD2E28D6B72766973D063DDC1792C329255438B580E4EECE8`: HEAD/status identical, no source SHA changes, 12 dist path changes. New Web CSS `apps/studio-web/dist/assets/index-jsEG3DHn.css` SHA256 `8B8AA7581262D68B1737A61C5587C4D545020C8C9AB73C211FC317555004ED0A`; Web JS `index-CSXp7xdq.js` SHA256 `FCD3395C510175F3485EAA329BDC885AF6CC687272BE17BFC77B7BC160A31A5A`; Desktop main JS SHA256 `09C1DE910BED84EE5902188116AF8EE0A02560BBC9CBC2799DD90E8F682A9F82`.

`geometry.json` SHA256 `4A33BBEEE69B3CD270066C75B2172303EC608A60234F1FEEDA89D7C6A5AFCC87`, screenshots at 720/881 SHA256 `D6AA528FFB4F35B80FF3B74DA4946AA0FDF10291A52C2FFB0D6CCC025EE90BAE` / `10D2EFCA29A7DB209C871184F360FFE2284507113ACC81CCBE14209A57C5E676`, and Panel stdout SHA256 `79E49968D97B1F2D4EAFD1AA736B96D62924CB17F2F9F1A51E676741E1F273D5` are retained. Post-test fingerprint SHA256 `6B68F1BA7037C909D737822823EEDA4035A9C9DD5D457996485499D0188A149A` and comparison show no source/dist drift. HEAD/status 110 unchanged and related processes 0 on release.

Limits: the Edge DOM is an isolated component using built CSS, not Electron native layout acceptance; QA02 must test the fixed dist. The frozen Panel only exposes manual read-only reconciliation. DEV04's independent automatic-read Panel delta was not synced here. Project entry model, selected-asset reader, rights schema, real provider, cost, installer, and whole-product acceptance are separate gates.

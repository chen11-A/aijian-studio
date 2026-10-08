# PROJECT Web typecheck comparison

Both runs used exact command `pnpm --filter @aijian/studio-web typecheck` from `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`. The package script invoked `tsc -b --pretty false` in both runs.

| Run | Raw stdout/stderr/exit | Result |
| --- | --- | --- |
| Previous PROJECT01 front window | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa03-project01-front-20260924\run-01\web-typecheck.stdout.txt`, `.stderr.txt`, `.exit.txt` | exit 0; stdout empty; stderr `$ tsc -b --pretty false` |
| This DemoApp global-route window | `web-typecheck.stdout.txt`, `.stderr.txt`, `.exit.txt` in this directory | exit 1; TS2304 `ProjectUpdateResult` and TS2322 optional revision |

Previous raw stdout SHA256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`, stderr `5E419D5756C7F39390F8B5CAC48831A2CF6A3983F8BD0916F14FE67EE9087170`, exit-file `13BF7B3039C63BF5A50491FA3CFD8EB4E699D1BA1436315AEF9CBE5711530354`. Current raw stdout SHA256 `A3C75D91F6DC16E83B86CA8394B4F1916D3909F6FA8DFF4F7FA9CE1749B2BDCC`, stderr `5E419D5756C7F39390F8B5CAC48831A2CF6A3983F8BD0916F14FE67EE9087170`, exit-file `F1B2F662800122BED0FF255693DF89C4487FBDCF453D3524A42D4EC20C3D9C04`.

`tsconfig.app.json` has `composite: true` and sets `tsBuildInfoFile` to `./node_modules/.tmp/tsconfig.app.tsbuildinfo`; current tsconfig SHA256 is `5DC3AB07B2ED621BA3D04DC3E1F9B98DC0CA0DDD90F49CE0CA715DAE4EDD40D2`. `tsbuildinfo-current.json` records the artifact **after the failing typecheck**: 86626 bytes, SHA256 `8354AD419878C1C17923BD3BEDA37A6E299759B2794B762D14043583A256391A`, mtime UTC `2026-09-24T08:20:20.2927194Z`. An earlier tsbuildinfo snapshot was not captured, so the reason the earlier incremental run missed these two source errors is **unconfirmed**.

Current read-only version checks, with stdout/stderr/exit in this directory: pnpm `11.9.0`, TypeScript `5.9.3`. Comparing the previous PROJECT01 69-source manifest with this window before typecheck shows only the authorized DemoApp file changed; the two error-bearing source files were byte-identical. After the controlled two-file fix, QA03 used `pnpm --filter @aijian/studio-web exec tsc -b --force --pretty false` for a full Web check; its separate raw and exit live in `../run-tsfix-01`.

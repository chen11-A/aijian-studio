# DEV04 × DEV07 本机 Sub2API 候选字段核对（只读）

2026-09-29 作者树单一物理源。DEV07 `work/dev07-sub2api-local-mode-20260929/MANIFEST.json` SHA-256 `57A125A71DE2AC0769A00639C352CDACBB7C8D3C1FDC08A4E41698C28B2611A8` 与现场一致；其中三个编辑文件当前 SHA 分别为 `75E341279A7E787EE196940FB637D3534C7B66093D32B5E2A613AC7C37353DBF`、`17392F8629550F1A6C495E68901721C528C05D6CCB538D49273959DC661151F7`、`7B4475800364301EDE5EA09AD9CAFD1A5E518F1BB54E5BF9D74AD7AF96D0AF3C`，均与 manifest 一致。未改 DEV07 或 DEV04 源码，未构建/测试/请求服务。

## 已对齐

- DEV04 与 DEV07 使用同一枚举 `PUBLIC_HTTPS | LOCAL_LOOPBACK_HTTP`；本机 origin 正则均只接受 `http://127.0.0.1:<1..65535>` 或 `http://[::1]:<1..65535>`，无路径、主机名或隐式端口。公网路径继续走 HTTPS。
- DEV07 create/edit 可省略 `origin_mode` 并按 `PUBLIC_HTTPS` 核旧请求；本机请求要求显式 mode。非 Sub2API 响应 mode 为 null。DEV04 创建/编辑候选在本机模式下不提交，因此不会意外落入省略即公网的旧兼容路径。
- DEV07 的 create、edit 回执校验含 mode、base URL、revision；DEV04 候选文案不声称保存成功，密钥不进入本地 journal。

## 同版本接入前必须处理

1. 当前 `@aijian/contracts` 与 Web `studio.ts` 的 create/edit/list 类型尚无 `origin_mode`；DEV04 管理面板还将连接默认为公网读回。待 DEV01/05/07 的持久合同和生成类型稳定，DEV04 需在独立写窗把显式 mode 送入 create/CAS、从列表/回执读回并在 CAS reconciliation 中比较 mode，不能仅比较 URL、revision。
2. DEV07 provider list/response validator 现在要求每条连接携带 mode；旧 sidecar 回执没有该字段时会被拒为不可信，故这份 desktop 源码不能单独合入旧后端并称公网兼容。DEV01/05 的 DB 回填、路由序列化和运行时选择必须先形成同版本闭包。
3. DEV07 local mode 只做 DTO/客户端预检；main/preload、执行时出站地址和重定向边界、配置持久化、真实 loopback 服务身份仍未在此候选验证。Migration 32/33 依赖尚待 DEV01/统一审签，不因 manifest 存在而视为已应用。

QA 请从这一组物理 SHA 建新隔离快照，并先做静态字段一致性/旧公网回执兼容矩阵；后续本机模拟仅在完整后端/desktop/Web 同版本后运行。旧 c19 hunk 和旧 W1 RED 不覆盖或复用为本候选的 GREEN。

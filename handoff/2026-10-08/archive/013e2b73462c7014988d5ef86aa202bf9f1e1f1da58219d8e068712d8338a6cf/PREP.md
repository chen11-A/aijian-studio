# SUB2API 表单外置组件门：待冻结，不运行

测试目标：真实 ProviderConnectionForm 组件与其 useProviderConnectionForm hook，使用 jsdom 和隔离的 onSubmit spy，不触 Electron、Sidecar、Provider 或网络。当前仅准备在 QA work 目录，未修改或运行 c19。

四例：SUB2API 选择后 origin 与业务 key 均为空且必填，用户填入 HTTPS origin/key/TEXT 后提交 kind=SUB2API；切换前的 IMAGE 模型不能残留，SUB2API 不提供可用非 TEXT 输入，缺 TEXT 不提交；OLLAMA 保持本地端点、无 key、IMAGE 能力；OPENAI 保持既有端点与 key 必填。URL 使用示例域名，只核表单 payload，不证明公网可达、授权或 provider 调用。真实 is_global 由后端权威验证，不能以 UI 字面校验取代。

执行门：等 DEV04 三文件冻结、MGR04 独立快照并保护同步 c19，再回核三文件与候选状态、测试定位器，之后由 MGR02 排定组件、DemoApp 6 例、web/desktop typecheck、web→desktop build。保留旧 TS2741/raw 和 DemoApp 旧断言/raw，不覆盖。

准备时 c19 只读基线：HEAD 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2、status57。旧三文件 SHA256：provider-settings-model.ts 07B405565894D4026647D3FA40549DDEC5587020F42A962E01E3D624F3D786CE；use-provider-connection-form.ts 297387ED697F9538EFD6DCD3004DA176B1C19E62AC29C496FD68DB091A936DE7；ProviderConnectionForm.tsx 460849B1959DB2442AF255973D58E990A21A37A50071EA1C5C72BF1C6CBC7C0E。测试尚未执行。

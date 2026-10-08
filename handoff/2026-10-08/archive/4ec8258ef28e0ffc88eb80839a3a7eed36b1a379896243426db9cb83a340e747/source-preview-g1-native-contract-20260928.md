# QA02 合成来源 G1 原生确认边界（2026-09-28）

第三轮未取得来源预览布局结果。隔离 DB 的合成项目及 7270 字节来源存在，source_manifest latest 有效；confirmation_challenges 恰有一条 G1 submit，consumed_at 为 NULL，review_submissions 为 0，review/accepted version 均为 NULL。Web 层点击“提交真实来源审核”之后，Electron main 正等待系统确认；runner 未处理确认，关闭窗口后停止。

当前 c19 只读源码链：

1. StoryPages.tsx 的 reviewSource() 提交 Web drawer 后调用 model.tsx 的 reviewRealSource()；成功才转故事页。
2. model.tsx 的 reviewRealSource() 读取 source manifest identity，调用 sourceReviewRunner.run("submit")。adapters/sourceManifest.ts 锁定该项目，结果 UNKNOWN 时不允许重试。
3. desktop/source-manifest-review.ts 的 submit 分支先 prepare_submit，之后 ask("submit") 等 Electron main 回调。收到肯定确认才调用 submitSourceManifestReview；确认不等于基线签署或批准。
4. desktop/source-manifest-review-ipc.ts 的系统框标题“送审来源版本”，详情有项目、版本、来源内容 hash、Gate/action、当前及评审证据修订；按钮为“取消”和“确认送审来源版本”，默认/取消均为“取消”。
5. confirm_baseline 是另一个意图；其代码先后要求 signoff 与 decision 两个独立系统确认。视觉 QA 不点击 Web“确认来源审核基线”，也不接受这两个原生动作。

新 runner 仅从隔离 DB 只读获取合成 project/version/hash/revision，核来源字节、未审核且无旧 challenge；Web 提交后调用外置 native-bm-click-once.ps1，只允许 action=submit、标题/按钮/owner/Win32 PID/HWND/前台及可见文字身份逐项匹配，最多发送一次。helper 发前写 durable intent，发送后仍标 BUSINESS_UNVERIFIED；最终以 read-only DB 看到一条已消费 G1 submit challenge、一条 review_submission、review_version=latest、accepted=NULL 作为后验。任何 gate 失败、发送结果不明或后验不符即正常关闭并保持 UNKNOWN，不复用 profile。

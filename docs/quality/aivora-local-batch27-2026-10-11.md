# AIVORA 第27批：声音与字幕的精确已确认剧本来源

总基线：`32d014624aad134a6884121a58a26b75088104c9`。
本批精确父提交：`6dd1fe6f03684e824c6c056e48c5b0aa83e7216f`。
本地候选：`codex/aivora-product-local-20261011`。
设计先独立审查，见 `docs/architecture/assembly-confirmed-script-provenance.md`。
本批完成 P14/P18/F01 的剧本来源依赖这一完整本地流程，未声称正式配音、口型、
声音授权、专业声音QA、PictureLock/master或全部声音需求已完成。

## 实际用户流程与单一真相

1. 仍在原剧本入口保存版本并显式人工确认；原不可变script和append-only confirmation
   是唯一来源。声音、装配读取最后确认及精确剧本正文，不用最新未确认草稿代替。
2. 声音入口可明确选最后确认剧本，再逐段把已导入真实录音绑定到精确对白；
   装配入口可选同一对白，实际添加或明确替换一条有精确帧区间的文字字幕。
   字幕保存真实text及script version/block/content hash，使用原DRAFT字幕编码路径。
   超长/不支持文字拒绝；仅在已有单行支持文字29至56个Unicode码点时插入一次28码点换行，
   不截断、转述、翻译或自动合成声音。
3. 全部来源绑定相同版本/hash后，用户显式选用最后人工确认回执；这是可undo/redo的
   未保存装配编辑，随后仍需原CAS另存与精确读回。音频/字幕/装配读同一对象，无新数据库。
   改字幕帧保留来源；修改文字必须明确转为手工字幕。局部表单未应用输入在刷新时保留，
   保存与导航仍受原输入保护。
4. 新未确认剧本只给独立warning；重复确认同version/hash产生的新receipt不使原有效pin失效。
   真正确认另一版本后，历史装配/导出证据保持原hash，状态列出精确受影响音频/字幕段；
   新的CONFIRMED装配保存和DRAFT导出拒绝。用户逐段改绑/替换，再明确选用新确认并另存。
   也可明确返回未确认DRAFT继续草稿，不能因此获得正式批准。

可选 `script_provenance` 与文字字幕 `script_ref` 省略时保持原schema1.0及旧hash；
新来源必须有明确DRAFT/CONFIRMED模式。CONFIRMED保存核精确receipt、script、block、
scope、hash和所有段同源；空来源、部分改绑、错hash/回执/作品/分集均拒绝。
复用原artifact_dependencies，DRAFT引用advisory、CONFIRMED引用blocking；读取比对完整
script+storyboard/G5依赖集合，缺边和多余边拒绝。原legacy不回填、不改绑。
`script_source_status`是同库真实确认的只读即时评估，不是另存的批准头或完整失效事件账本。
确认不更新Gate/accepted_head，不产生任务、Provider、发布、编码或费用。

新消费保存使用同一BEGIN IMMEDIATE；导出准入、worker开始、encode前和原最终writer事务
均核真实确认。排队后新确认在encoder前拒绝；编码中到达的新确认不发布成功文件或成功回执。
原原件/权利/技术探测/G5检查与32视觉32音频/30分钟/1920、32MiB边界全部保留。

## 独立审查与真实边界

初审复现1项P2：原装配恢复路径无条件删除journal，晚到409会删掉替换记录，随后GET误解锁。
现仅删除精确原canonical CAS intent且回读验证；原记录丢失时补回原intent，替换时保留替换
记录并保留原请求的内存未决锁，不能导航放弃。未知/坏保存回执仅GET核对，绝不重发。
确认来源GET不能清UNKNOWN；原提交内容/parent/revision精确读回仍可结束原UNKNOWN，
即使其确认来源后来已过期，也不把历史成功误判成失败或重复执行。
双作用域、A→B→A、迟到读取、坏确认/正文/当前自洽、已见head回退或同head矛盾均拒绝采用。
这一内存已见版本保护不是第二业务存储。

独立原源码快照、原失败、修复两种重放、报告及最终SHA在
`docs/quality/evidence/aivora-batch27/independent_raw/`，复制原字节SHA单列。
独立范围17后端、60个不同renderer、35desktop用例通过，不与主检查重复相加。
有限代码审查不能证明全部历史需求或安全问题穷尽。

## 验证与未验证

`docs/quality/evidence/aivora-batch27/`保存命令、退出码、原stdout/stderr及源码SHA：

- 后端5文件54项通过：临时真实SQLite重开、精确历史hash、确认替换/重复/新草稿、
  完整持久依赖、坏边/错source/hash/block/receipt/scope、真实ASGI认证与拒绝、原G5/装配/
  DRAFT回归；确认无Gate/任务/费用副作用。新增17项中两个竞态导出测试明确使用受控encoder：
  其中写入的协议字节不是MP4，不能当真实编码或Windows验收。
- renderer7文件93项通过：实际字幕添加/替换/帧编辑/手工转换/脏输入，来源采用/逐段修复，
  读取不改内容、duplicate与draft提示、A→B→A、回退/矛盾、UNKNOWN/坏回执/替换和移除journal，
  原音频绑定/undo/save/readback重开回归。jsdom和gateway协议不是真实窗口或播放。
- desktop4文件35项通过：真实LocalApiClient读回新/旧合同，闭合字段/来源投影/精确scope/
  hash/状态矛盾拒绝，原字幕、分镜与client兼容；不执行Windows原生解码。
- 全仓TS no-emit、6生产Python mypy、受影响TS ESLint/7Python Ruff、格式和contracts通过；
  原路径和非预期旧schema保持精确，合同只作本批明确加法。门槛/CI/coverage/许可/安全不变。

保留开发中失败日志：新增测试夹具把expected_revision写成expected_head_revision、
猜错原合成对白文本；新DRAFT回执测试夹具漏source status；测试union窄类型和格式/import-order
错误已修复。一次Vitest命令附带不存在的旧测试名，实际未运行且不计覆盖，最后命令移除。
重复回归不累加。未重复无关全量/coverage；未执行构建、安装或用户Windows验证。
原测试日志空白EOF原字节保留，源码/文档单独whitespace检查，不改日志冒称原输出。
前26批保留于累计源码和证据，第26包不覆盖。

## 剩余及下一批

仍缺完整持久确认失效事件/整作品影响、独立正式声音/字幕审签版本、读本/混音批准、
声线权利/授权、对齐口型、PictureLock、master、正式输出/签发和动态预演。
正式环境状态人工批准为下一批，复用原权利与G5、精确版本和人工决定，不凭字段宣称通过。
随后补供应商无关媒体任务/候选持久流程；真实媒体协议缺项见产品矩阵，当前Sub2API真实
运输仅TEXT。预算选择待用户答复，不阻无费用实现，不猜供应商或费用策略。

没有push/merge/main/远端CI、账号workspace/凭据修改、真实模型/图片/视频/语音调用或收费，
没有自动重发UNKNOWN、构建安装、原生执行或绕过拒绝。Windows电脑仍未操作；转移时先
检查未提交内容，任何重启先请保存确认。原Word未逐页核对，不宣称23页五阶段全产品验收。

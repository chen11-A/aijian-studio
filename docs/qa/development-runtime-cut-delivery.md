# 稳定开发线：资源、重装、剪辑撤销与恢复

本批产品merge `f562c3f7d838004692f0eddac59fc4afe717c5f8`，固定候选
`f20dc3a9cece6e374722e1ffe9bae9923cc5ef60`。从已交dev96dd仅接资源闭包、
同candidate重装保留、原生合成回写后的剪辑撤销、Windows恢复四修，不带API53/54。
原提交ca303/29140/f7/c657分别回移为4a5f3af/399fb30/5efa2a7/f20dc3a。

## 完整界面与打包

独立冻结 `/workspace/aivora-action-scene-validation@5efa2a7`，没有在检查期间改源：

- 原完整renderer：467文件、5560项、527.28秒；原覆盖门exit0，
  stmt90.33/branch86.79/fn92.58/line93.07，未降低门槛或排除生产文件。
- 正式desktop/web类型与构建、contracts、全TS lint、全格式、135 Node契约均0。
  试片40、ruler22、剪辑历史24为重叠定向检查，未加进完整5560。
- SDK44所有实际导出在隔离目录加载；compiled trial/recovery/audio factory、
  206可信资产和picker验证0，无仓库运行时源码依赖。
- 原runtime9、reinstall proof4、packaging/collector 50pass/1原平台skip/
  36subtests均0；真实Windows资源collector及保留production builder亦0。
  收据candidate_head为5efa，闭包6受审动态入口、9模块、470资源文件，
  authorization与release_approved均false。

首runtime复验7pass/2fail，实际错误是该复用工作树未安装独立Windows
build-toolchain，缺`@electron/asar`和`app-builder-lib`。按原package-lock运行
`npm ci --prefix packaging/windows/build-toolchain --ignore-scripts --no-audit --no-fund`
后，同源重跑原9项通过；不修改产品、测试或校验。首失败日志保留。

日志：`/tmp/aivora-delivered-runtime-cut-root-*`（正式质量/完整界面）、
`/tmp/aivora-delivered-runtime-root-*`（首依赖失败）、
`/tmp/aivora-delivered-runtime-ready-root-*`（补齐原锁依赖后全部通过及实际收据）。

## Windows恢复

f20相对5efa只增加恢复Python、其新边界测试和自有QA；apps、packages、config、
scripts、packaging和pnpm-lock均无diff。API52实际运行原恢复两文件12项加新7项，
联合19pass/9.53秒；全Ruff、586文件格式、mypy322均exit0。
日志`/tmp/aivora-delivered-windows-recovery-root-tests.log`。

原叶c657另有root 20pass/10.14秒，其中多一项诊断透明性测试；不将该计数冒为
本批API52完整套件。真实Windows
[run42392208223/job128461948628](https://github.com/chen11-A/aijian-studio/actions/runs/42392208223/job/128461948628)
保留原断言和固定命令，原speech17成功16:41:37、原recovery12成功16:42:01、
原清单/归属成功16:42:13。旧02cb跨API ctime失败仍保留，完整性保护未删除。

## 证据边界

- API52原完整5258pass/6skip仅对应基线6825；本批恢复叶以新19及实际Windows
  原12证明，不声称修改后全Python已重跑。
- 新正常Chrome484全部通过来自功能源c4de/run42391608207；API53配置等候选
  页面并未随本批API52交付。截图artifact未下载或目视检查。
- fe399/run42380766815真实安装、同candidate重装、重启回读、卸载保留成功，
  只对应该固定包；不冒不同版本升级或本批f20/未来54新包。
- 后端与前端继续54真实前置图准入/持久lineage/cache/连续帧/取消联调。
  main、tag、正式包发布及付费推理未动。

# AIVORA第三轮：代码与现有素材音量

分支 `gpt/aivora-modules`。遵照用户最新“稍等，你先改代码和音量”，素材下载、补充与新合成已暂停。此前成果保留；本阶段没有将新医院/人体音效或40秒夜街版本加入主库。当前仍187条：156音效、31配乐文件（22首独立作品及9个已有作品的派生版）。只改两个获准目录，不合并、不创建PR。

## 已完成代码

- 挑选器钢管、铁棍、棍子只匹配管类拟音，缺少就告缺，不再用金属罐替代。
- 环境音按整场连续编排；镜头视图的`sourceStart`和淡化状态承接整场轨道。调用方选择整场轨道或镜头视图渲染，不应同时叠加二者。
- 环境素材可用`suggestedGainDb`进一步下压默认增益，不能提高音量；无效值不影响计划。开伞/收伞分别匹配，缺素材如实告缺。
- 备份`.jpg/.webp/.mov/.m4a/.mp3`和原有压缩媒体一样使用STORE；真实检查ZIP中央目录方式与导入内容。
- 竖屏保护“每一天”等时间数量短语，保留标点规则和超长串拆分。Electron打包接入必须显式传入可访问的`fontsDirectory`，README已说明。
- 当前generated素材来源固定到实际提交号，不再指向移动分支。

## 音量处理与检查

选择用户方案(a)：对现有素材增加增益后做192kHz四倍过采样动态限幅，再回到48kHz、编码Ogg并重测。187条中79条实际修改，16条受处理循环的原音解码接缝通过。循环三遍处理后仅保留中间原长度，避免限幅器启动状态破坏循环边界；动态范围发生改变，未进行人工试听。

`check.py`强制音效−21至−15 LUFS、配乐−22至−18 LUFS；`peakLimited`不再豁免。仅5个不足400毫秒、附说明且实际积分响度不可测的短音保留null。所有素材仍需真峰值和采样峰值≤−1。

实测音效−20.98至−17.95 LUFS，配乐−21.75至−19.96 LUFS；最高真峰值−1.05 dBTP、最高采样峰值−1.052554 dBFS。纸页翻动1由−35.24提高到−20.01 LUFS。逐条前后数据见 [ROUND3_NORMALIZATION.json](../../assets/audio-library/ROUND3_NORMALIZATION.json)。普通和严格CLI分别实际执行，原样输出、响度范围统计和退出码见素材库 CHECK_OUTPUT.json、STRICT_CHECK_OUTPUT.json、CHECK_COMMAND.txt、VALIDATION.json。

严格素材验收仍报告雨伞数量不足、人体倒地和医院底噪缺项；不能将代码和音量通过解释为暂停的素材补充已完成。素材目录约64MB，低于150MB，准确值以检查产物的扫描时点为准。

## 测试

Linux、Node24.19.0、FFmpeg7.1.5。`npm test`234项通过，Python48项通过，类型检查通过。语句/函数/行覆盖率均100%；下表为测试数和分支覆盖率。

| 模块 | 测试数 | 分支覆盖率 |
| --- | ---: | ---: |
| audio-library | 48 | 100% |
| audio-picker | 57 | 99.49% |
| subtitles | 27 | 98.66% |
| export-check | 12 | 95.61% |
| loudness | 11 | 97.50% |
| cover-title | 16 | 100% |
| project-archive | 37 | 92.85% |
| rough-cut | 26 | 100% |

测试日志（仅去行尾空白）在 TEST_OUTPUT.txt，Python日志在 PYTHON_TEST_OUTPUT.txt，覆盖率原数据在 COVERAGE_SUMMARY.json。1,074,790,400字节真实文件打包/还原及独立SHA256一致，STORE归档1,074,790,943字节；本次打包约21.59秒、导入2.23秒、峰值RSS约134.1MiB，见 project-archive/PERFORMANCE.json。Windows实机测试按用户要求暂缓。

## 场景与暂停工作

第三轮三个场景完整原样对象在 [ROUND3_SCENARIO_RESULTS.json](audio-picker/ROUND3_SCENARIO_RESULTS.json)，前四场景输出在 [SCENARIO_RESULTS.json](audio-picker/SCENARIO_RESULTS.json)。多镜头环境源位置连续、钢管匹配正确；人体倒地、医院底噪、开伞和收伞仍明确返回缺素材警告。

暂停前已产生但未纳入清单：自制人体/医院6个音频、3个准确40秒的夜街替换版本；另有雨伞候选资料和两首音乐接缝试听导出脚本，均保留供用户后续恢复。未继续下载或新合成，音乐试听文件也暂未导出。生成脚本在暂停前已单独保存提交b878a32，当前没有其6个成品进入素材库。更早素材补缺的检查点为40049a9；未重置或丢弃它。

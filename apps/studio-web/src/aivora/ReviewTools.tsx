import { useDemo } from "./model";
import { seconds } from "./data";
import { Button, FlowFooter, Info, PageTitle, Pill } from "./Common";

export function ChangesPage() {
  const d = useDemo();
  const included = d.annotations.filter((note) => note.included);
  return (
    <>
      <PageTitle
        actions={
          <Pill>{d.value("reviewDone") === "true" ? "审核完成 · 演示" : "审片批注草案"}</Pill>
        }
      />
      <div className="changes-layout">
        <aside className="visual-details">
          <h2>批注分组</h2>
          {["剪辑节奏", "字幕", "音量", "画面表现"].map((category) => (
            <button
              className="task-row"
              key={category}
              onClick={() =>
                d.put("changeFilter", category === d.value("changeFilter") ? "" : category)
              }
            >
              <strong>{category}</strong>
              <small>{d.annotations.filter((note) => note.category === category).length} 项</small>
            </button>
          ))}
          <Button onClick={() => d.put("changeFilter", "")}>显示全部</Button>
        </aside>
        <section>
          <h2>建议修改方案</h2>
          <p className="muted">逐项选择。只调整你明确批准的范围。</p>
          {d.annotations
            .filter((note) => !d.value("changeFilter") || note.category === d.value("changeFilter"))
            .map((note) => (
              <article className="change-card" key={note.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={note.included}
                    onChange={() =>
                      d.setAnnotations((old) =>
                        old.map((item) =>
                          item.id === note.id ? { ...item, included: !item.included } : item,
                        ),
                      )
                    }
                  />
                  <strong>{note.category}</strong>
                  <Pill>{seconds(note.start)}</Pill>
                </label>
                <p>{note.text}</p>
                <small>
                  {note.category === "画面表现"
                    ? "建议：创建新候选，保留原镜头"
                    : `建议：使用${note.category}编辑，保留原画面`}
                </small>
                <div className="actions">
                  <Button
                    onClick={() =>
                      d.edit(
                        "编辑修改方案项",
                        [
                          {
                            key: "text",
                            label: "修改要求",
                            value: note.text,
                            type: "textarea",
                            required: true,
                          },
                        ],
                        (data) =>
                          d.setAnnotations((old) =>
                            old.map((item) =>
                              item.id === note.id ? { ...item, text: data.text! } : item,
                            ),
                          ),
                      )
                    }
                  >
                    编辑方案
                  </Button>
                  <Button
                    onClick={() =>
                      d.setEditor({
                        title: "影响范围",
                        description: `${seconds(note.start)}—${seconds(note.end)}\n修改类型：${note.category}\n保留：其他镜头、角色身份、场景设定和现有候选。\n真实费用：未知。`,
                      })
                    }
                  >
                    查看影响
                  </Button>
                </div>
              </article>
            ))}
          {!d.annotations.length && (
            <Info title="尚无批注">
              <p>先回到审片页添加意见。</p>
            </Info>
          )}
        </section>
        <aside className="visual-details">
          <h2>执行范围</h2>
          <strong className="large-number">
            {included.length}
            <small> 项已选择</small>
          </strong>
          <dl>
            <dt>保留内容</dt>
            <dd>未选中方案及所有原版本</dd>
            <dt>执行方式</dt>
            <dd>内存演示，不提交真实任务</dd>
            <dt>真实费用</dt>
            <dd>未知</dd>
          </dl>
          <Pill tone="amber">演示不会生成媒体</Pill>
          <p>{d.tasks[0]?.status ?? "等待你的决定"}</p>
        </aside>
      </div>
      <FlowFooter
        label="确认并执行"
        disabled
        reason="尚未接入执行器，方案可编辑保存"
        secondaryLabel="返回审片"
        secondaryAction={() => d.go("review")}
      />
    </>
  );
}
export function ExportSettings() {
  const d = useDemo();
  return (
    <aside className="visual-details">
      <h2>输出设置</h2>
      {[
        { key: "format", label: "格式", options: ["MP4 (H.264)", "MOV"] },
        { key: "resolution", label: "分辨率", options: ["1920 × 1080", "3840 × 2160"] },
        { key: "fps", label: "帧率", options: ["24 fps", "25 fps", "30 fps"] },
        { key: "captions", label: "字幕", options: ["内嵌字幕", "独立字幕文件", "不含字幕"] },
      ].map((field) => (
        <label key={field.key}>
          {field.label}
          <select
            value={d.value(field.key, field.options[0])}
            onChange={(event) => d.put(field.key, event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
      <Pill tone="amber">设置仅保存在演示内存中</Pill>
    </aside>
  );
}

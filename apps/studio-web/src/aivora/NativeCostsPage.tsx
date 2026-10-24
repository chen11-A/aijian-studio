import { useEffect } from "react";
import { Button, PageTitle } from "./Common";
import { ProjectCosts } from "./ProjectCosts";
import { useDemo } from "./model";

export function NativeCostsPage() {
  const d = useDemo();
  const reload = d.taskQueue.reload;
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <div className="v2-utility-page v2-utility-management">
      <PageTitle
        actions={
          <>
            <Button onClick={() => d.go("project")}>选择作品</Button>
            <Button onClick={() => d.go("services")}>前往 AI 服务</Button>
          </>
        }
      />
      <details className="native-cost-note">
        <summary>账本和订阅怎么分开</summary>
        <p>
          Grok API 预付费账与下面的作品账本分开。Grok 订阅额度不能在这里使用，已连接账号在 AI
          服务。缺少金额时不写成零，这里也不开启预算保护。
        </p>
      </details>
      <ProjectCosts projectId={d.backendProjectId} queue={d.taskQueue} />
    </div>
  );
}

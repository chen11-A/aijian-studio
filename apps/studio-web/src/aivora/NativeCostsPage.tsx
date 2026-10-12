import { Button, PageTitle } from "./Common";
import { ProjectCosts } from "./ProjectCosts";
import { useDemo } from "./model";

export function NativeCostsPage() {
  const d = useDemo();
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
      <ProjectCosts projectId={d.backendProjectId} queue={d.taskQueue} />
    </div>
  );
}

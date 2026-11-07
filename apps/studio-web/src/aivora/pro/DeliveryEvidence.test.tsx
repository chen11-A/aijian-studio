import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DeliveryEvidence } from "./DeliveryEvidence";
import { deliveryEvidenceView } from "./actions/delivery-evidence-view";
import { writtenDelivery } from "./delivery-evidence.test-fixture";
afterEach(cleanup);
it("shows main filename/SHA and technical unknowns while explicitly retaining human review", () => {
  const raw = writtenDelivery();
  render(<DeliveryEvidence view={deliveryEvidenceView(raw, "PUBLISHED")} partial={false} />);
  expect(screen.getByRole("heading", { name: "交付清单已生成" })).toBeInTheDocument();
  expect(screen.getByText(raw.fileName)).toBeInTheDocument();
  expect(screen.getByText(raw.manifestSha256)).toBeInTheDocument();
  expect(screen.getByText("平均帧率（不代表恒定帧率）")).toBeInTheDocument();
  for (const note of raw.manifest.unverified) expect(screen.getByText(note)).toBeInTheDocument();
  expect(
    screen.getByText("技术检查、文件存在或点击播放，都不等于已经完整观看和试听。"),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/private-shot-id|private-take-id|全部质量已通过/);
});
it("keeps legacy and failed manifests distinct from generated evidence and never invents missing sidecars", () => {
  const view = render(
    <DeliveryEvidence view={deliveryEvidenceView(undefined, "PUBLISHED")} partial={false} />,
  );
  expect(screen.getByText("这次导出未提供交付清单，暂时不能核对交付证据。")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "交付清单已生成" })).not.toBeInTheDocument();
  view.rerender(
    <DeliveryEvidence
      partial
      view={deliveryEvidenceView(
        {
          kind: "FAILED",
          code: "EVIDENCE_WRITE_FAILED",
          files: [{ role: "video", aspectRatio: "9:16", fileName: "已落视频.mp4" }],
        },
        "PARTIAL",
      )}
    />,
  );
  expect(screen.getByText("本次导出仅完成一部分，已写出的文件保留。")).toBeInTheDocument();
  expect(screen.getByText("已落视频.mp4")).toBeInTheDocument();
  expect(screen.queryByText("封面")).not.toBeInTheDocument();
  expect(screen.queryByText("清单 SHA256")).not.toBeInTheDocument();
});

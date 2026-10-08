import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { M2Stop } from './m2-once-flow.mjs';
import { readPostcloseProvenance, verifyProvenanceRows } from './m2-provenance.mjs';
import { playbackProbeInPage } from './m2-media-events.mjs';

const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, text) => { throw new M2Stop(code, text); };
const within = (root, path) => {
  const child = relative(resolve(root), resolve(path));
  return !!child && child !== '..' && !child.startsWith('..\\') &&
    !child.startsWith('../') && !isAbsolute(child);
};
const guardedFile = (root, path) => {
  if (!within(root, path) || !lstatSync(path).isFile() ||
    lstatSync(path).isSymbolicLink() || realpathSync(path) !== resolve(path))
    fail('FILE_BOUNDARY', `untrusted file path: ${path}`);
  return path;
};
const sourceCommand = (h, operationId) => ({ operation_id: operationId,
  input: { source_manifest_version_id: h.source_manifest_version_id,
    source_document_id: h.source_document_id } });
const journal = async (page, key) => page.evaluate((item) => {
  const raw = window.localStorage.getItem(item);
  return raw === null ? null : JSON.parse(raw);
}, key);
const bridge = (page, method, ...args) => page.evaluate(async ([name, values]) => {
  if (!window.aijian || typeof window.aijian[name] !== 'function')
    throw new Error(`preload method unavailable: ${name}`);
  return window.aijian[name](...values);
}, [method, args]);
const foreground = () => {
  const script = [
    "Add-Type -TypeDefinition @'",
    'using System; using System.Runtime.InteropServices;',
    'public static class M2Foreground {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);',
    '}',
    "'@",
    '$m2Handle = [M2Foreground]::GetForegroundWindow()',
    '[uint32]$m2Pid = 0',
    '[M2Foreground]::GetWindowThreadProcessId($m2Handle, [ref]$m2Pid) | Out-Null',
    '[pscustomobject]@{ hwnd = $m2Handle.ToInt64().ToString(); pid = $m2Pid } | ConvertTo-Json -Compress',
  ].join('\n');
  return JSON.parse(execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 10000 }).trim());
};

export class M2ElectronDriver {
  constructor({ handoff, ffprobePath, evidenceRoot, record }) {
    this.handoff = handoff;
    this.ffprobePath = ffprobePath;
    this.evidenceRoot = evidenceRoot;
    this.record = record;
    this.app = null;
    this.page = null;
    this.closed = false;
    this.pid = null;
  }
  async open() {
    const exe = join(repo, 'apps/desktop/node_modules/electron/dist/electron.exe');
    guardedFile(join(repo, 'apps/desktop'), exe);
    this.app = await electron.launch({ executablePath: exe,
      args: [join(repo, 'apps/desktop'), `--user-data-dir=${this.handoff.profile_path}`],
      cwd: repo, env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: this.handoff.profile_path },
      timeout: 30000 });
    this.pid = this.app.process()?.pid ?? null;
    this.page = await this.app.firstWindow({ timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await this.page.locator('.demo-root').waitFor({ state: 'visible', timeout: 30000 });
    const rootCount = await this.page.locator('.demo-root').count();
    if (rootCount !== 1) fail('NATIVE_WINDOW', 'renderer root is not unique');
    const sample = () => this.app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1) return { count: windows.length };
      const main = windows[0];
      const handle = main.getNativeWindowHandle();
      return { count: 1, pid: process.pid, id: main.id,
        hwnd: handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : null,
        visible: main.isVisible(), focused: main.isFocused(),
        loading_main_frame: main.webContents.isLoadingMainFrame() };
    });
    const readySamples = [];
    const readyDeadline = Date.now() + 15000;
    let ready = null;
    while (Date.now() < readyDeadline) {
      const row = await sample();
      readySamples.push({ utc: new Date().toISOString(), ...row });
      if (row.count !== 1 || row.pid !== this.pid || !row.hwnd) {
        await this.record('window_ready_samples', readySamples);
        fail('NATIVE_WINDOW', 'main window identity unavailable or changed');
      }
      if (ready && row.id !== ready.id) {
        await this.record('window_ready_samples', readySamples);
        fail('NATIVE_WINDOW', 'main window replaced');
      }
      ready = row;
      if (row.visible && !row.loading_main_frame) break;
      await this.page.waitForTimeout(100);
    }
    await this.record('window_ready_samples', readySamples);
    if (!ready?.visible || ready.loading_main_frame)
      fail('WINDOW_READY_TIMEOUT', 'product did not naturally show a ready main window');
    const first = { native: await sample(), foreground: foreground() };
    await this.page.waitForTimeout(250);
    const second = { native: await sample(), foreground: foreground() };
    await this.record('native_window', { first, second });
    if (first.native.count !== 1 || second.native.count !== 1 ||
      first.native.pid !== this.pid || second.native.pid !== this.pid ||
      !first.native.hwnd || first.native.hwnd !== second.native.hwnd ||
      first.native.id !== ready.id || second.native.id !== ready.id ||
      !first.native.visible || !second.native.visible ||
      first.native.loading_main_frame || second.native.loading_main_frame ||
      !first.native.focused || !second.native.focused ||
      first.foreground.hwnd !== first.native.hwnd ||
      second.foreground.hwnd !== second.native.hwnd ||
      first.foreground.pid !== this.pid || second.foreground.pid !== this.pid)
      fail('FOREGROUND_UNKNOWN', 'stable visible foreground main window not confirmed');
  }
  async sessionIdentity() {
    return { pid: this.pid, profile: this.handoff.profile_path,
      workspace: this.handoff.workspace_path, url: this.page.url() };
  }
  async readFrozenSourceBytes() {
    return readFileSync(this.handoff.input_path);
  }
  async capture(label) {
    const path = join(this.evidenceRoot, `${label}.png`);
    const bytes = await this.page.screenshot({ path, fullPage: true, timeout: 15000 });
    await this.record('screenshot', { label, path, bytes: bytes.length,
      sha256: digest(bytes) });
  }
  async readSource(h) {
    const project = await bridge(this.page, 'getProject', h.project_id);
    await this.record('project_get_raw', project);
    const manifest = await bridge(this.page, 'getSourceManifest', h.project_id);
    await this.record('manifest_get_raw', manifest);
    const source = await bridge(this.page, 'getSource', h.project_id, h.source_document_id);
    await this.record('source_document_get_raw', source);
    const sourceText = await bridge(this.page, 'getSourceText', h.project_id, h.source_document_id);
    await this.record('source_text_get_raw', sourceText);
    if (!project?.data?.name) fail('PROJECT_NAME', 'project GET has no display name');
    await this.page.getByRole('button', { name: '项目中心' }).first().click();
    const row = this.page.locator('.v2-project-row').filter({ hasText: project.data.name });
    if (await row.count() !== 1) fail('PROJECT_SELECTION', 'project row is not unique');
    await row.getByRole('button', { name: '打开项目' }).click();
    await this.record('project_opened', { id: h.project_id, name: project.data.name });
    await this.page.getByRole('button', { name: '故事 / 剧本' }).click();
    const sourceStatus = this.page.locator('.v2-source-support[role="status"]')
      .filter({ hasText: '来源状态：已批准。' });
    await sourceStatus.first().waitFor({ timeout: 30000 });
    if (await sourceStatus.count() !== 1 ||
      !(await sourceStatus.textContent())?.includes(
        `最新来源 V${manifest?.data?.accepted_version?.version_number} 已批准`))
      fail('SOURCE_UI', 'visible source status does not match accepted version');
    await this.record('source_ui_status', {
      text: await sourceStatus.textContent(), selector: '.v2-source-support[role="status"]' });
    return { project, manifest, source, sourceText };
  }
  async prepareFake(h) {
    await this.page.getByRole('button', { name: '制作', exact: true }).click();
    await this.page.getByRole('group', { name: '制作页面' })
      .getByRole('button', { name: '镜头生成' }).click();
    await this.page.getByRole('region', { name: '本地 Fake 开发任务' }).waitFor();
    const pending = await journal(this.page, `aijian.fake-timeline-run.pending.v1:${h.project_id}`);
    const recovered = await journal(this.page, `aijian.fake-timeline-run.recovered.v1:${h.project_id}`);
    if (pending || recovered) fail('FAKE_JOURNAL_EXISTS', 'a prior operation already occupies this project');
    await this.page.getByLabel('选择本地 Fake 制作来源').selectOption(h.source_document_id);
    await this.page.getByRole('button', { name: '核对来源' }).click();
    await this.page.getByText('来源与已批准清单匹配；可明确提交本地 Fake 任务。').waitFor({ timeout: 30000 });
    if (!await this.page.getByRole('button', { name: '提交本地 Fake 任务' }).isEnabled())
      fail('FAKE_PREFLIGHT', 'submit remains disabled');
  }
  async submitFakeOnce(h) {
    await this.page.getByRole('button', { name: '提交本地 Fake 任务' }).click();
    const pendingKey = `aijian.fake-timeline-run.pending.v1:${h.project_id}`;
    const recoveredKey = `aijian.fake-timeline-run.recovered.v1:${h.project_id}`;
    let operation = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const recovered = await journal(this.page, recoveredKey);
      const pending = await journal(this.page, pendingKey);
      operation = recovered ?? pending;
      if (operation?.operation_id) break;
      await this.page.waitForTimeout(250);
    }
    if (!operation?.operation_id) fail('FAKE_UNKNOWN', 'click returned without durable operation ID');
    await this.record('fake_journal', operation);
    const result = await bridge(this.page, 'queryFakeTimelineRunOperation', h.project_id,
      sourceCommand(h, operation.operation_id));
    await this.record('fake_original_get', result);
    if (result?.kind !== 'FOUND') fail('FAKE_UNKNOWN', `original GET: ${result?.kind ?? 'missing'}`);
    const receipt = result.receipt?.data;
    if (receipt?.operation_id !== operation.operation_id ||
      receipt?.project_id !== h.project_id ||
      receipt?.source_document_id !== h.source_document_id ||
      receipt?.source_manifest_version_id !== h.source_manifest_version_id ||
      (operation.task_id && operation.task_id !== receipt.task_id))
      fail('FAKE_IDENTITY', 'original GET identity differs from journal');
    return { operation_id: operation.operation_id, task_id: receipt.task_id,
      attempt_id: receipt.attempt_id, workflow_run_id: receipt.workflow_run_id,
      node_run_id: receipt.node_run_id, request_id: result.receipt.request_id };
  }
  async waitTaskAndMedia(h, fake) {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const response = await bridge(this.page, 'listProjectTasks', h.project_id);
      const item = response?.data?.tasks?.find((row) => row.task.task_id === fake.task_id);
      if (item) {
        await this.record('task_poll', { request_id: response.request_id,
          task: item.task, attempt: item.attempt });
        if (item.attempt.attempt_id !== fake.attempt_id ||
          item.task.kind !== 'local.timeline.assemble.fake.media.v1' ||
          item.attempt.execution_mode !== 'local') fail('TASK_IDENTITY', 'task identity changed');
        if (item.attempt.status === 'SUCCEEDED' && item.task.status === 'COMPLETED') {
          await this.page.getByRole('button', { name: '刷新任务列表' }).click();
          await this.page.getByLabel('选择要查询的 Fake 任务').selectOption(fake.task_id);
          await this.page.getByRole('button', { name: '查询任务与时间线' }).click();
          await this.page.getByText('任务、素材与当前真实时间线版本一致；已重新读取组装页。')
            .waitFor({ timeout: 30000 });
          return { task_id: fake.task_id, status: 'SUCCEEDED',
            output_version_id: item.attempt.output_version_id };
        }
        if (['FAILED', 'CANCELLED', 'REMOTE_UNKNOWN'].includes(item.attempt.status))
          fail('TASK_FAILED', `attempt terminal: ${item.attempt.status}`);
      }
      await this.page.waitForTimeout(2000);
    }
    fail('TASK_UNKNOWN', 'task deadline exceeded');
  }
  async readTimeline(h) {
    const deadline = Date.now() + (this.reorderExpectedRevision ? 15000 : 1000);
    let response;
    do {
      response = await bridge(this.page, 'getProjectTimeline', h.project_id);
      if (!this.reorderExpectedRevision ||
        response?.data?.timeline?.revision >= this.reorderExpectedRevision) {
        this.reorderExpectedRevision = null;
        return response;
      }
      await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return response;
  }
  async verifyPackage(timelineResponse, h, task) {
    const binding = timelineResponse.data.timeline.media_package;
    const packageRoot = join(h.workspace_path, 'fake-media', 'v1', h.project_id,
      binding.media_package_id);
    if (!within(h.workspace_path, packageRoot)) fail('MEDIA_PACKAGE', 'package escaped workspace');
    const manifestPath = guardedFile(packageRoot, join(packageRoot, 'manifest.json'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const sorted = (value) => Array.isArray(value) ? value.map(sorted) :
      value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
        .map((key) => [key, sorted(value[key])])) : value;
    const canonical = `sha256:${digest(Buffer.from(JSON.stringify(sorted(manifest))))}`;
    const manifestHashMatch = canonical === binding.manifest_sha256;
    const sourceBindingMatch = manifest.project_id === h.project_id &&
      manifest.source_document_id === h.source_document_id &&
      manifest.source_sha256 === h.source_sha256 &&
      manifest.package_id === binding.media_package_id &&
      timelineResponse.data.version_id === task.output_version_id;
    const previewAudits = [];
    for (const item of binding.assets) {
      const path = guardedFile(packageRoot, join(packageRoot, item.preview_relative_path));
      const bytes = readFileSync(path);
      const shot = manifest.shots.find((entry) =>
        entry.preview_video.relative_path === item.preview_relative_path);
      previewAudits.push({ path: item.preview_relative_path, bytes: bytes.length,
        sha256: `sha256:${digest(bytes)}`, expected: item.preview_sha256,
        frame_count: shot?.preview_video?.frame_count,
        match: bytes.length === item.preview_byte_length &&
          `sha256:${digest(bytes)}` === item.preview_sha256 &&
          shot?.preview_video?.sha256 === item.preview_sha256 &&
          shot?.preview_video?.frame_count === 125 });
    }
    return { manifest_path: manifestPath, manifest_hash_match: manifestHashMatch,
      source_binding_match: sourceBindingMatch,
      preview_hashes_match: previewAudits.length === 3 &&
        previewAudits.every((item) => item.match), previewAudits };
  }
  async reorderFirstOnce(original) {
    await this.page.getByRole('group', { name: '制作页面' })
      .getByRole('button', { name: '成片组装' }).click();
    const clipId = original.data.timeline.clips[0].clip_id;
    const button = this.page.getByRole('button', { name: new RegExp(`镜头 1 ${clipId}$`) });
    if (await button.count() !== 1) fail('REORDER_UI', 'first clip is not unique');
    await button.focus();
    this.reorderExpectedRevision = original.data.timeline.revision + 1;
    await button.press('Alt+ArrowRight');
    await this.page.getByRole('button', { name: '重新读取' }).first().click();
  }
  async prepareExport(edited) {
    await this.page.getByRole('button', { name: '开发 MP4 导出' }).click();
    await this.page.getByRole('region', { name: '开发 MP4 导出' }).waitFor();
    const operation = await journal(this.page,
      `aivora.development-export.v2.${this.handoff.project_id}`);
    if (operation) fail('EXPORT_JOURNAL_EXISTS', 'prior export operation exists');
    const summary = await this.page.getByRole('region', { name: '开发 MP4 导出' }).textContent();
    if (!summary?.includes(`修订 ${edited.revision} · 375 帧`) ||
      !await this.page.getByRole('button', { name: '生成开发 MP4' }).isEnabled())
      fail('EXPORT_PREFLIGHT', 'edited timeline is not exportable in UI');
  }
  async exportOnce(edited) {
    await this.page.getByRole('button', { name: '生成开发 MP4' }).click();
    const key = `aivora.development-export.v2.${this.handoff.project_id}`;
    let operation = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      operation = await journal(this.page, key);
      if (operation?.status === 'SUCCEEDED' || operation?.status === 'REJECTED' ||
        operation?.status === 'UNKNOWN') break;
      await this.page.waitForTimeout(250);
    }
    if (!operation?.operationId) fail('EXPORT_UNKNOWN', 'click returned without journal operation');
    await this.record('export_journal', operation);
    if (operation.projectId !== this.handoff.project_id ||
      operation.timelineVersionId !== edited.version_id ||
      operation.contentHash !== edited.content_hash || operation.revision !== edited.revision)
      fail('EXPORT_IDENTITY', 'journal identity differs from edited timeline');
    if (operation.status === 'REJECTED') {
      const rejection = operation.rejection;
      if (rejection?.outcome === 'SAFE_FIRST_REJECTION' &&
        rejection?.requestEffect === 'NO_EXPORT_CLAIM')
        fail('EXPORT_DEFINITE_REJECTION', JSON.stringify(rejection));
      fail('EXPORT_UNKNOWN', 'rejection did not prove no claim');
    }
    if (operation.status !== 'SUCCEEDED') {
      const response = await bridge(this.page, 'getDevelopmentExport',
        this.handoff.project_id, operation.operationId, edited.version_id, edited.revision);
      await this.record('export_original_get', response);
      if (response?.data?.status !== 'SUCCEEDED')
        fail('EXPORT_UNKNOWN', 'original GET is not succeeded');
      return { operation_id: operation.operationId, receipt: response };
    }
    const response = await bridge(this.page, 'getDevelopmentExport',
      this.handoff.project_id, operation.operationId, edited.version_id, edited.revision);
    await this.record('export_original_get', response);
    return { operation_id: operation.operationId, receipt: response };
  }
  async verifyFileAndPlayback(result) {
    const output = result.output;
    const path = guardedFile(this.handoff.workspace_path,
      join(this.handoff.workspace_path, ...output.relative_path.split('/')));
    const bytes = readFileSync(path);
    const fileHashMatch = bytes.length === output.byte_length &&
      `sha256:${digest(bytes)}` === output.sha256;
    if (!fileHashMatch) fail('OUTPUT_HASH', 'export bytes differ from receipt');
    const probe = JSON.parse(execFileSync(this.ffprobePath,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
    await this.record('ffprobe_raw', probe);
    const video = probe.streams?.find((item) => item.codec_type === 'video');
    const audio = probe.streams?.find((item) => item.codec_type === 'audio');
    const ffprobeMatch = probe.format?.format_name?.includes('mp4') &&
      video?.codec_name === 'h264' && video.pix_fmt === 'yuv420p' &&
      video.width === 1080 && video.height === 1920 &&
      video.r_frame_rate === '25/1' && video.avg_frame_rate === '25/1' &&
      Number(video.nb_frames) === 375 &&
      Math.abs(Number(probe.format.duration) - 15) < 0.1 &&
      output.has_audio === !!audio &&
      (!audio || (audio.codec_name === 'aac' && Number(audio.sample_rate) === 48000));
    if (!ffprobeMatch) fail('FFPROBE_MISMATCH', 'MP4 stream metadata differs');
    if (bytes.length > 64 * 1024 * 1024) fail('PREVIEW_TOO_LARGE',
      'page preview exceeds limit; require separately observed system-player run');
    await this.page.getByRole('button', { name: '读取页面预览' }).click();
    const player = this.page.getByLabel('当前开发 MP4 页面预览');
    await player.waitFor({ timeout: 30000 });
    const playback = await player.evaluate(playbackProbeInPage);
    const metadata = playback.metadata;
    return { path, file_hash_match: fileHashMatch, ffprobe_match: ffprobeMatch,
      ffprobe: probe, metadata, playback, playback_ended: playback.ended &&
        playback.samples.every((sample) => sample.time > sample.requested) &&
        new Set(playback.samples.map((sample) => sample.center_rgb.join(','))).size === 3 };
  }
  async close() {
    if (this.app) await this.app.close();
    this.closed = true;
  }
  async closedIdentity() {
    return { pid: this.pid, normal_close: this.closed,
      singleton_lock_absent: !lstatSync(this.handoff.profile_path).isSymbolicLink() &&
        !require('node:fs').existsSync(join(this.handoff.profile_path, 'SingletonLock')) };
  }
  async verifyPostcloseProvenance(original, edited, h, fake, task) {
    if (!this.closed) fail('CLOSE_UNKNOWN', 'SQLite provenance requires normal close');
    guardedFile(h.workspace_path, join(h.workspace_path, 'workspace.sqlite3'));
    const readback = readPostcloseProvenance(h.workspace_path, original, edited, h);
    await this.record('postclose_sqlite_raw_rows', readback);
    return { ...readback,
      verified: verifyProvenanceRows(readback.raw_rows, original, edited, h, fake, task) };
  }
}

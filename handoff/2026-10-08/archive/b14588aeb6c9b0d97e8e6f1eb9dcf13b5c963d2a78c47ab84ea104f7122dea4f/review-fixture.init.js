// Installed with Playwright addInitScript before the pinned production Web bundle mounts.
// This is an isolated read-only bridge fixture, not a product review or approval record.
(() => {
  const projectId = `prj_${'1'.repeat(32)}`;
  const versionId = `ver_${'2'.repeat(32)}`;
  const sourceId = `src_${'7'.repeat(32)}`;
  const sourceText = '来源正文需要独立滚动，不遮住状态或按钮。'.repeat(350);
  const sourceSha = 'cd54ad6c6cbc109f7bbccae504fce59bf20b0b155ddf0fe8f4df50f152ff33b1';
  const source = {
    id: sourceId, project_id: projectId, filename: 'qa-local-review-fixture.txt',
    media_type: 'text/plain', sha256: `sha256:${sourceSha}`, raw_sha256: sourceSha,
    bytes: 21000, blocks: [{ id: `blk_${'9'.repeat(32)}`, ordinal: 1, text: sourceText }],
    created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
  };
  const version = {
    artifact_id: `art_${'3'.repeat(32)}`, id: versionId, parent_version_id: null,
    version_number: 4, schema_version: '1.0.0',
    content_hash: `sha256:${'4'.repeat(64)}`, change_summary: 'QA本地审核态夹具',
    created_at: '2026-09-14T00:00:00Z',
    content: { scope_type: 'full_work', documents: [] },
  };
  const manifest = {
    request_id: 'qa-local-manifest', data: {
      project_id: projectId,
      head: {
        artifact_id: version.artifact_id, latest_version_id: versionId,
        review_version_id: versionId, review_submission_id: `sub_${'5'.repeat(32)}`,
        accepted_version_id: null, revision: 1, review_evidence_revision: 0,
        updated_at: '2026-09-14T00:00:00Z',
      },
      latest_version: version, review_version: version, accepted_version: null,
    },
  };
  const calls = [];
  const forbidden = [];
  const record = (name, result) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(result);
  };
  const reject = name => (...args) => {
    forbidden.push({ name, args });
    return Promise.reject(new Error(`QA fixture rejects mutation: ${name}`));
  };
  Object.defineProperty(window, '__qaBridgeCalls', { value: calls, configurable: false });
  Object.defineProperty(window, '__qaForbiddenCalls', { value: forbidden, configurable: false });
  window.aijian = {
    health: record('health', { request_id: 'qa-health', data: { status: 'ok', service: 'aijian-api', version: 'qa-fixture' } }),
    listProjects: record('listProjects', { request_id: 'qa-projects', data: [{
      id: projectId, name: 'QA来源布局项目', status: 'active', revision: 1,
      updated_at: '2026-09-14T00:00:00Z',
    }] }),
    listSources: record('listSources', { request_id: 'qa-sources', data: [source] }),
    getSource: record('getSource', { request_id: 'qa-source', data: source }),
    getSourceText: record('getSourceText', { request_id: 'qa-source-text', data: {
      id: sourceId, project_id: projectId, raw_sha256: sourceSha,
      normalized_text: sourceText, normalized_sha256: sourceSha,
    } }),
    getSourceManifest: record('getSourceManifest', manifest),
    createProject: reject('createProject'), updateProject: reject('updateProject'),
    importTextSource: reject('importTextSource'),
    submitSourceManifest: reject('submitSourceManifest'),
    confirmSourceManifestBaseline: reject('confirmSourceManifestBaseline'),
    copySourceManifestDraft: reject('copySourceManifestDraft'),
  };
  window.fetch = (...args) => {
    forbidden.push({ name: 'fetch', args: args.map(String) });
    return Promise.reject(new Error('QA fixture rejects fetch'));
  };
})();

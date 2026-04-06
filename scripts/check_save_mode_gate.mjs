import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const MAIN_PATH = path.join(ROOT, 'src', 'main.js');
const STORE_PATH = path.join(ROOT, 'src', 'core', 'project-store.js');

function check(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail };
}

async function run() {
  const mainJs = await readFile(MAIN_PATH, 'utf8');
  const storeModule = await import(pathToFileURL(STORE_PATH).href);
  const checks = [];

  const {
    createProjectStore,
    normalizeSaveFormat,
    SAVE_FORMAT_LINKED,
    SAVE_FORMAT_EMBEDDED,
  } = storeModule;

  checks.push(check(
    'normalize_save_format_defaults_to_linked',
    normalizeSaveFormat(undefined) === SAVE_FORMAT_LINKED
      && normalizeSaveFormat('anything-else') === SAVE_FORMAT_LINKED
      && normalizeSaveFormat(SAVE_FORMAT_EMBEDDED) === SAVE_FORMAT_LINKED,
    'embedded는 명시적 예외(reason=explicit-user-choice)일 때만 허용되어야 합니다.',
  ));

  checks.push(check(
    'normalize_save_format_allows_embedded_only_explicitly',
    normalizeSaveFormat(SAVE_FORMAT_EMBEDDED, { allowEmbedded: true, reason: 'explicit-user-choice' }) === SAVE_FORMAT_EMBEDDED
      && normalizeSaveFormat(SAVE_FORMAT_EMBEDDED, { allowEmbedded: true, reason: 'not-allowed' }) === SAVE_FORMAT_LINKED
      && normalizeSaveFormat(SAVE_FORMAT_EMBEDDED, { allowEmbedded: false, reason: 'explicit-user-choice' }) === SAVE_FORMAT_LINKED,
    'allowEmbedded + explicit-user-choice 조합 외에는 embedded를 linked로 강등해야 합니다.',
  ));

  const store = createProjectStore();
  checks.push(check(
    'project_store_default_save_mode_is_linked',
    store.getState().saveFormat === SAVE_FORMAT_LINKED,
    `default=${store.getState().saveFormat}`,
  ));
  store.setSaveFormat(SAVE_FORMAT_EMBEDDED);
  const blockedState = store.getState().saveFormat;
  store.setSaveFormat(SAVE_FORMAT_EMBEDDED, { allowEmbedded: true, reason: 'explicit-user-choice' });
  const explicitState = store.getState().saveFormat;
  checks.push(check(
    'project_store_embedded_requires_explicit_exception',
    blockedState === SAVE_FORMAT_LINKED && explicitState === SAVE_FORMAT_EMBEDDED,
    `blocked=${blockedState}, explicit=${explicitState}`,
  ));

  checks.push(check(
    'main_default_save_mode_literal_is_linked',
    /let\s+currentSaveFormat\s*=\s*SAVE_FORMAT_LINKED\s*;/.test(mainJs),
    'main.js의 현재 저장 포맷 기본값은 linked여야 합니다.',
  ));

  checks.push(check(
    'main_embedded_branch_is_explicit_exception_only',
    mainJs.includes("allowEmbedded: true")
      && mainJs.includes("reason: 'explicit-user-choice'")
      && mainJs.includes('const allowEmbedded = format === SAVE_FORMAT_EMBEDDED;'),
    'embedded 허용 분기는 explicit-user-choice 예외로 분리되어야 합니다.',
  ));

  checks.push(check(
    'main_default_save_path_avoids_embedded_literal_call',
    !mainJs.includes("downloadByFormat('embedded'"),
    '기본 저장 경로에서 embedded 직접 호출은 금지합니다.',
  ));

  const downloadEditedBlockMatch = mainJs.match(/async function downloadEditedHtml\(\) {[\s\S]*?^}\n/m);
  const downloadEditedBlock = downloadEditedBlockMatch ? downloadEditedBlockMatch[0] : '';
  checks.push(check(
    'main_default_save_path_no_data_url_generation_pattern',
    downloadEditedBlock.includes('downloadByFormat(currentSaveFormat)')
      && !downloadEditedBlock.includes('data:'),
    '기본 저장 함수(downloadEditedHtml) 경로에는 data URL 생성/저장 로직이 없어야 합니다.',
  ));

  const ok = checks.every((item) => item.ok);
  const payload = { ok, checks };
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exitCode = 1;
}

run().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: String(error?.stack || error),
  }, null, 2));
  process.exitCode = 1;
});

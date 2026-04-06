import { FIXTURE_MANIFEST, FIXTURE_SOURCE_MAP, getFixtureMeta } from './fixture-bundle.js';
import {
  AUTOSAVE_KEY,
  EXPORT_PRESETS,
  HISTORY_LIMIT,
  PROJECT_SNAPSHOT_KEY,
  PROJECT_SNAPSHOT_LIMIT,
  getExportPresetById,
} from './config.js';
import { createImportFileIndex, choosePrimaryHtmlEntry } from './core/asset-resolver.js';
import { normalizeProject } from './core/normalize-project.js';
import {
  buildRuntimeAssetRef,
  ensureRuntimeAssetRecords,
  registerRuntimeAsset,
  resolveRuntimeAssetPreviewUrl,
} from './core/runtime-assets.js';
import { createProjectStore } from './core/project-store.js';
import { createFrameEditor } from './editor/frame-editor.js';
import {
  renderAssetTable,
  renderIssueList,
  renderLeftTabStepGuide,
  renderLayerTree,
  renderLocalModeNotice,
  renderNormalizeStats,
  renderPreflight,
  renderProjectMeta,
  renderSectionFilmstrip,
  renderSelectionInspector,
  renderSlotList,
  renderSummaryCards,
  renderUploadAssetLibrary,
} from './ui/renderers.js';
import { buildZipBlob, downloadBlob, downloadTextFile, sanitizeFilename, slugify } from './utils.js';

const store = createProjectStore();
let activeEditor = null;
let mountedProjectId = '';
let pendingMountOptions = null;
let currentExportPresetId = 'market';
let currentCodeSource = 'edited';
let codeEditorDirty = false;
let lastCodeDiffSummary = { changedLines: 0, addedLines: 0, removedLines: 0, firstChangedLine: 0, draftLines: 0, draftChars: 0 };
let codeCompareBaseMode = 'current-source';
let codeCompareTargetMode = 'draft';
let lastCodeCompareResult = { baseKey: 'current-source', targetKey: 'draft', baseLabel: '현재 보기', targetLabel: '현재 초안', chunkCount: 0, changedLines: 0, addedLines: 0, removedLines: 0, truncated: false, chunks: [] };
let codeWorkbenchDiagnostics = [];
let geometryCoordMode = 'relative';
let currentSaveFormat = 'linked';
let lastSaveConversion = null;
let advancedSettingsDirty = false;
let lastFocusedBeforeShortcutHelp = null;
let lastFocusedBeforeDownloadModal = null;
let importRequestSequence = 0;
const zoomState = { mode: 'fit', value: 1 };
let previewFrameBindingsCleanup = null;
let previewFrameResizeRaf = 0;
let previewFrameHeightStabilizeRaf = 0;
let previewFrameHeightStabilizePasses = 0;
let lastPreviewFrameHeight = 0;
const sectionDragState = { uid: '', uids: [], targetUid: '', position: 'after' };
let sectionPanelSelectionUids = [];
let sectionPanelAnchorUid = '';
let previewSpacePanArmed = false;
let previewPanState = null;
let lastAppliedCodeImpact = null;
let lastCodeCompareCache = { baseText: null, targetText: null, result: null };
let codeCompareWorkerInstance = null;
let codeCompareWorkerUrl = '';
let codeCompareRenderToken = 0;
const codeCompareExpandedChunkKeys = new Set();
let codeCompareIssuesOnly = false;
const sectionPreviewImageCache = new Map();
let currentSectionThumbnailPreset = 'auto';
let lastStyleColorPalette = [];
let lastCssTokenPalette = [];
let lastDesignTokenPalette = [];
let lastInlineColorExtractCandidates = [];
let lastSectionThemePalettes = [];
let lastMarketLintIssues = [];
let lastContrastLintIssues = [];
let lastContrastLintCacheKey = '';
let codeCompareColorOnly = false;
let themeStudioMode = 'colors';
let themeStudioMounted = false;
let hoveredSectionPreviewUid = '';
const SECTION_THUMBNAIL_PRESET_STORAGE_KEY = 'detail_editor_section_thumb_preset_v1';
const QA_CHECKLIST_ITEMS = Object.freeze([
  { group: '열기/복구', items: ['HTML 파일 열기', '폴더 열기', '자동저장 복구', '스냅샷 복원'] },
  { group: '선택/배치', items: ['단일 선택', 'Shift 다중 선택', '드래그 이동', '리사이즈', '정렬/간격', '앞뒤 순서'] },
  { group: '이미지/슬롯', items: ['업로드 카드 드래그로 슬롯 교체', '슬롯 더블클릭 크롭', '이미지 잠금', '맞춤/채우기 프리셋', '선택 PNG/JPG/섹션 ZIP'] },
  { group: 'HTML 왕복', items: ['캔버스 → HTML', 'HTML → 캔버스', 'diff 비교', '적용 전 검사', '원본/정규화/편집본 왕복'] },
  { group: '긴 문서 탐색', items: ['미니맵 클릭 점프', 'PageUp/PageDown 섹션 점프', 'Space 핸드툴', '섹션 패널 드래그 재정렬'] },
]);
let sectionPreviewRenderToken = 0;
let minimapStructureSignature = '';
let previewMinimapSyncRaf = 0;
let currentViewportSectionUid = '';
const viewFeatureFlags = {
  snap: true,
  guide: true,
  ruler: false,
};
const OPEN_DOWNLOAD_MODAL_BUTTON_LABEL = '저장/출력 열기';
const DEFAULT_JPG_QUALITY = 0.92;
const WORKFLOW_STEP_GUIDES = Object.freeze({
  load: 'HTML 파일이나 폴더를 먼저 불러오세요.',
  edit: '요소를 클릭한 뒤 드래그하세요.',
  save: `결과를 확인한 뒤 [${OPEN_DOWNLOAD_MODAL_BUTTON_LABEL}] 버튼을 눌러 실행하세요.`,
});
const LEFT_TAB_TO_WORKFLOW_STEP = Object.freeze({
  'left-start': 'load',
  'left-image': 'load',
  'left-text': 'edit',
  'left-properties': 'edit',
  'left-theme': 'edit',
  'left-layers': 'edit',
  'left-diagnostics': 'save',
  'left-export': 'save',
});
const WORKFLOW_STEP_TO_LEFT_TAB = Object.freeze({
  load: 'left-start',
  edit: 'left-properties',
  save: 'left-export',
});
const SHORTCUT_TOOLTIP_MAP = Object.freeze({});
const BOOT_LOCAL_POLICY = Object.freeze({
  requiresStartupFetch: false,
  requiresFileSystemAccessApi: false,
  requiresServerEndpoint: false,
});
const SUPPORTED_IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const SUPPORTED_IMAGE_EXTENSIONS_TEXT = SUPPORTED_IMAGE_EXTENSIONS.join(', ');
const APP_STATES = Object.freeze({
  launch: 'launch',
  editor: 'editor',
});
let currentAppState = APP_STATES.launch;
const BEGINNER_MODE_STORAGE_KEY = 'detail_editor_beginner_mode_v1';
const ONBOARDING_COMPLETED_STORAGE_KEY = 'detail_editor_onboarding_completed_v1';
const ONBOARDING_SAMPLE_CHECKED_STORAGE_KEY = 'detail_editor_onboarding_sample_checked_v1';
const COMMAND_REGISTRY = Object.freeze([
  { id: 'tool-select', label: '선택 도구', shortcut: 'V', keywords: ['선택', '화살표', 'v'], run: () => { setSelectionMode('smart'); return { ok: true, message: '선택 도구(V)로 전환했습니다.' }; } },
  { id: 'tool-text', label: '텍스트 도구', shortcut: 'T', keywords: ['텍스트', '글자', 't'], run: () => { setSelectionMode('text'); return { ok: true, message: '텍스트 도구(T)로 전환했습니다.' }; } },
  { id: 'tool-box', label: '박스 도구', shortcut: 'R', keywords: ['박스', '사각형', 'r'], run: () => { setSelectionMode('box'); return { ok: true, message: '박스 도구(R)로 전환했습니다.' }; } },
  { id: 'duplicate', label: '선택 복제', shortcut: 'Ctrl/Cmd + D', keywords: ['복제', '복사', 'duplicate'], run: () => executeEditorCommand('duplicate') },
  { id: 'delete', label: '선택 삭제', shortcut: 'Delete', keywords: ['삭제', '지우기', 'remove'], run: () => executeEditorCommand('delete') },
  { id: 'group', label: '그룹 묶기', shortcut: 'Ctrl/Cmd + G', keywords: ['그룹', '묶기'], run: () => executeEditorCommand('group-selection') },
  { id: 'ungroup', label: '그룹 해제', shortcut: 'Shift + Ctrl/Cmd + G', keywords: ['그룹해제', '해제', 'ungroup'], run: () => executeEditorCommand('ungroup-selection') },
  { id: 'save-edited', label: '문서 저장', shortcut: 'Ctrl/Cmd + S', keywords: ['저장', '세이브', 'save'], run: () => { downloadEditedHtml().catch((error) => setStatus(`문서 저장 중 오류: ${error?.message || error}`)); return { ok: true, message: '문서 저장을 실행했습니다.' }; } },
  { id: 'toggle-lock', label: '선택 잠금 토글', shortcut: 'Shift + Ctrl/Cmd + L', keywords: ['잠금', 'lock'], run: () => activeEditor ? activeEditor.toggleSelectedLocked() : { ok: false, message: '먼저 미리보기를 로드해 주세요.' } },
  { id: 'layer-forward', label: '앞으로 가져오기', shortcut: 'Ctrl/Cmd + ]', keywords: ['앞으로', '레이어', 'z-order'], run: () => executeEditorCommand('layer-index-forward') },
  { id: 'layer-backward', label: '뒤로 보내기', shortcut: 'Ctrl/Cmd + [', keywords: ['뒤로', '레이어', 'z-order'], run: () => executeEditorCommand('layer-index-backward') },
  { id: 'fit-canvas', label: '화면 맞춤', shortcut: 'Ctrl/Cmd + 0', keywords: ['화면 맞춤', 'fit', 'zoom'], run: () => { setZoom('fit'); return { ok: true, message: '화면 맞춤으로 전환했습니다.' }; } },
  { id: 'section-prev', label: '이전 섹션으로 이동', shortcut: 'PageUp', keywords: ['이전 섹션', 'pageup', 'section'], run: () => ({ ok: jumpSectionByOffset(-1), message: '이전 섹션으로 이동했습니다.' }) },
  { id: 'section-next', label: '다음 섹션으로 이동', shortcut: 'PageDown', keywords: ['다음 섹션', 'pagedown', 'section'], run: () => ({ ok: jumpSectionByOffset(1), message: '다음 섹션으로 이동했습니다.' }) },
  { id: 'section-up', label: '섹션 위로 이동', shortcut: 'Alt + ↑', keywords: ['섹션 위', 'section move up'], run: () => applySectionAction('move-up', '', { fromMenu: false }) },
  { id: 'section-down', label: '섹션 아래로 이동', shortcut: 'Alt + ↓', keywords: ['섹션 아래', 'section move down'], run: () => applySectionAction('move-down', '', { fromMenu: false }) },
  { id: 'export-png', label: '전체 PNG 내보내기', shortcut: '-', keywords: ['png', '내보내기', '이미지'], run: () => { exportFullPng().catch((error) => setStatus(`PNG 내보내기 오류: ${error?.message || error}`)); return { ok: true, message: '전체 PNG 내보내기를 실행했습니다.' }; } },
  { id: 'section-add', label: '섹션 추가', shortcut: '-', keywords: ['섹션 추가', 'section', '블록 추가'], run: () => {
    if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
    const uid = store.getState().editorMeta?.selectedSectionUid || '';
    return activeEditor.addSectionAfterUid(uid);
  } },
  { id: 'stack-horizontal', label: '가로 스택 정렬', shortcut: '-', keywords: ['가로', 'stack', '정렬'], run: () => applyStackCommand('horizontal') },
  { id: 'stack-vertical', label: '세로 스택 정렬', shortcut: '-', keywords: ['세로', 'stack', '정렬'], run: () => applyStackCommand('vertical') },
  { id: 'tidy-horizontal', label: '가로 간격 맞춤', shortcut: '-', keywords: ['가로 간격', 'tidy', '균등'], run: () => applyTidyCommand('x') },
  { id: 'tidy-vertical', label: '세로 간격 맞춤', shortcut: '-', keywords: ['세로 간격', 'tidy', '균등'], run: () => applyTidyCommand('y') },
  { id: 'toggle-shortcut-help', label: '단축키 치트시트 열기/닫기', shortcut: '?', keywords: ['도움말', '단축키', '치트시트'], run: () => ({ ok: true, message: toggleShortcutHelp() ? '단축키 치트시트를 열었습니다.' : '단축키 치트시트를 닫았습니다.' }) },
]);
const BEGINNER_TUTORIAL_STEPS = Object.freeze([
  {
    id: 'slot-select',
    title: '1) 슬롯 선택',
    body: '먼저 [슬롯 지정] 버튼을 눌러 선택한 요소를 슬롯으로 지정하세요.',
    targetElementKey: 'manualSlotButton',
  },
  {
    id: 'replace-image',
    title: '2) 이미지 교체',
    body: '이제 [이미지 넣기] 버튼을 눌러 이미지를 교체하세요.',
    targetElementKey: 'replaceImageButton',
  },
  {
    id: 'save-png',
    title: '3) PNG 저장',
    body: '마지막으로 상단 [PNG] 버튼을 눌러 저장하면 온보딩이 끝나요.',
    targetElementKey: 'exportPngButton',
  },
]);
let isBeginnerMode = false;
let beginnerTutorialStepIndex = 0;
let onboardingCompleted = false;
let lastFocusedBeforeCommandPalette = null;
let commandPaletteResults = [];
let commandPaletteActiveIndex = 0;

const historyState = {
  baseSnapshot: null,
  undoStack: [],
  redoStack: [],
};
const HISTORY_MERGE_WINDOW_MS = 700;
const LIVE_HISTORY_LABELS = new Set(['geometry-patch', 'apply-text-style', 'clear-text-style']);

const advancedSettings = {
  geometryCoordMode: 'relative',
  exportScale: 1,
  exportJpgQuality: DEFAULT_JPG_QUALITY,
  selectionExportPadding: 16,
  selectionExportBackground: 'transparent',
};

const EXPORT_SCALE_OPTIONS = Object.freeze([1, 2, 3]);
const EXPORT_NEXT_ACTION_HINTS = Object.freeze({
  'export-full-png': '다음: 업로드 화면에서 비율(권장 860px 기준)을 확인해 주세요.',
  'export-full-jpg': '다음: 톤/압축 품질을 확인한 뒤 공유하세요.',
  'export-selection-png': '다음: 선택 범위 경계가 맞는지 바로 확인해 주세요.',
  'export-sections-zip': '다음: ZIP을 풀어 섹션 파일 순서와 누락 여부를 확인해 주세요.',
  'download-export-preset-package': '다음: ZIP을 풀고 목적(업로드/검수/보관)에 맞게 전달해 주세요.',
});
const IMPORT_FAILURE_GUIDES = Object.freeze({
  htmlOpen: '안내: HTML 파일(.html/.htm)인지 확인하고 다시 선택해 주세요.',
  folderNoHtml: '안내: 폴더 안에 대표 HTML 파일(예: index.html)을 넣어 주세요.',
  folderImport: '안내: HTML과 assets 폴더를 같은 루트에서 다시 선택해 주세요.',
  pasteMalformed: '안내: 닫히지 않은 태그(예: </div>)를 확인한 뒤 다시 붙여넣어 주세요.',
});

const elements = {
  appLauncher: document.getElementById('appLauncher'),
  appShell: document.getElementById('appShell'),
  leftSidebar: document.getElementById('leftSidebar'),
  rightSidebar: document.getElementById('rightSidebar'),
  appStatusbar: document.getElementById('appStatusbar'),
  launcherNewButton: document.getElementById('launcherNewButton'),
  launcherUploadButton: document.getElementById('launcherUploadButton'),
  launcherRecentButton: document.getElementById('launcherRecentButton'),
  launcherFixtureButtons: Array.from(document.querySelectorAll('[data-launch-fixture]')),
  fixtureSelect: document.getElementById('fixtureSelect'),
  openHtmlButton: document.getElementById('openHtmlButton'),
  openFolderButton: document.getElementById('openFolderButton'),
  loadFixtureButton: document.getElementById('loadFixtureButton'),
  applyPasteButton: document.getElementById('applyPasteButton'),
  replaceImageButton: document.getElementById('replaceImageButton'),
  manualSlotButton: document.getElementById('manualSlotButton'),
  demoteSlotButton: document.getElementById('demoteSlotButton'),
  toggleHideButton: document.getElementById('toggleHideButton'),
  toggleLockButton: document.getElementById('toggleLockButton'),
  redetectButton: document.getElementById('redetectButton'),
  textEditButton: document.getElementById('textEditButton'),
  duplicateButton: document.getElementById('duplicateButton'),
  deleteButton: document.getElementById('deleteButton'),
  addTextButton: document.getElementById('addTextButton'),
  addBoxButton: document.getElementById('addBoxButton'),
  addSlotButton: document.getElementById('addSlotButton'),
  selectionSmartButton: document.getElementById('selectionSmartButton'),
  groupButton: document.getElementById('groupButton'),
  ungroupButton: document.getElementById('ungroupButton'),
  undoButton: document.getElementById('undoButton'),
  redoButton: document.getElementById('redoButton'),
  restoreAutosaveButton: document.getElementById('restoreAutosaveButton'),
  saveProjectSnapshotButton: document.getElementById('saveProjectSnapshotButton'),
  openDownloadModalButton: document.getElementById('openDownloadModalButton'),
  downloadModal: document.getElementById('downloadModal'),
  closeDownloadModalButton: document.getElementById('closeDownloadModalButton'),
  downloadChoiceSelect: document.getElementById('downloadChoiceSelect'),
  runDownloadChoiceButton: document.getElementById('runDownloadChoiceButton'),
  downloadPresetButtons: Array.from(document.querySelectorAll('[data-download-preset]')),
  saveFormatSelect: document.getElementById('saveFormatSelect'),
  saveFormatStatus: document.getElementById('saveFormatStatus'),
  saveFormatGuide: document.getElementById('saveFormatGuide'),
  saveFormatPreview: document.getElementById('saveFormatPreview'),
  saveMetaSummary: document.getElementById('saveMetaSummary'),
  modalDownloadEditedButton: document.getElementById('modalDownloadEditedButton'),
  downloadEditedButtons: Array.from(document.querySelectorAll('[data-download-action="save-edited"]')),
  downloadNormalizedButton: document.getElementById('downloadNormalizedButton'),
  downloadLinkedZipButton: document.getElementById('downloadLinkedZipButton'),
  modalExportPngButton: document.getElementById('modalExportPngButton'),
  exportPngButton: document.getElementById('exportPngButton'),
  exportPngButtons: Array.from(document.querySelectorAll('[data-download-action="export-full-png"]')),
  modalExportJpgButton: document.getElementById('modalExportJpgButton'),
  exportJpgButtons: Array.from(document.querySelectorAll('[data-download-action="export-full-jpg"]')),
  exportSectionsZipButton: document.getElementById('exportSectionsZipButton'),
  exportSelectionPngButton: document.getElementById('exportSelectionPngButton'),
  exportPresetPackageButton: document.getElementById('exportPresetPackageButton'),
  selectionExportPaddingInput: document.getElementById('selectionExportPaddingInput'),
  selectionExportBackgroundSelect: document.getElementById('selectionExportBackgroundSelect'),
  exportPresetSelect: document.getElementById('exportPresetSelect'),
  exportScaleSelectMain: document.getElementById('exportScaleSelectMain'),
  exportScaleSelectControls: Array.from(document.querySelectorAll('[data-export-scale-control]')),
  exportJpgQualityInputMain: document.getElementById('exportJpgQualityInputMain'),
  exportJpgQualityInputs: Array.from(document.querySelectorAll('[data-export-jpg-quality-control]')),
  downloadReportButton: document.getElementById('downloadReportButton'),
  htmlFileInput: document.getElementById('htmlFileInput'),
  folderInput: document.getElementById('folderInput'),
  replaceImageInput: document.getElementById('replaceImageInput'),
  htmlPasteInput: document.getElementById('htmlPasteInput'),
  topbarDocTitle: document.getElementById('topbarDocTitle'),
  summaryCards: document.getElementById('summaryCards'),
  issueList: document.getElementById('issueList'),
  uploadAssetLibrary: document.getElementById('uploadAssetLibrary'),
  uploadRecentList: document.getElementById('uploadRecentList'),
  uploadDocumentList: document.getElementById('uploadDocumentList'),
  uploadUnassignedList: document.getElementById('uploadUnassignedList'),
  uploadBrokenList: document.getElementById('uploadBrokenList'),
  snapshotNameInput: document.getElementById('snapshotNameInput'),
  saveSnapshotFromPanelButton: document.getElementById('saveSnapshotFromPanelButton'),
  snapshotList: document.getElementById('snapshotList'),
  normalizeStats: document.getElementById('normalizeStats'),
  selectionInspector: document.getElementById('selectionInspector'),
  slotList: document.getElementById('slotList'),
  sectionList: document.getElementById('sectionList'),
  sectionDuplicateButton: document.getElementById('sectionDuplicateButton'),
  sectionMoveUpButton: document.getElementById('sectionMoveUpButton'),
  sectionMoveDownButton: document.getElementById('sectionMoveDownButton'),
  sectionDeleteButton: document.getElementById('sectionDeleteButton'),
  sectionAddButton: document.getElementById('sectionAddButton'),
  sectionDockCloseButton: document.getElementById('sectionDockCloseButton'),
  sectionSelectionSummary: document.getElementById('sectionSelectionSummary'),
  sectionNoteInput: document.getElementById('sectionNoteInput'),
  applySectionNoteButton: document.getElementById('applySectionNoteButton'),
  clearSectionNoteButton: document.getElementById('clearSectionNoteButton'),
  sectionNoteSummary: document.getElementById('sectionNoteSummary'),
  selectionEmptyState: document.getElementById('selectionEmptyState'),
  selectionContextCard: document.getElementById('selectionContextCard'),
  selectionContextTitle: document.getElementById('selectionContextTitle'),
  selectionContextMeta: document.getElementById('selectionContextMeta'),
  selectionContextChips: document.getElementById('selectionContextChips'),
  selectionContextHint: document.getElementById('selectionContextHint'),
  inspectorContextBadge: document.getElementById('inspectorContextBadge'),
  leftInspectorInspectSection: document.getElementById('leftInspectorInspectSection'),
  leftInspectorTextSection: document.getElementById('leftInspectorTextSection'),
  leftInspectorImageSection: document.getElementById('leftInspectorImageSection'),
  leftInspectorArrangeSection: document.getElementById('leftInspectorArrangeSection'),
  imageInspectorSummary: document.getElementById('imageInspectorSummary'),
  imageInspectorHint: document.getElementById('imageInspectorHint'),
  inspectorReplaceImageButton: document.getElementById('inspectorReplaceImageButton'),
  inspectorCropModeButton: document.getElementById('inspectorCropModeButton'),
  inspectorRemoveImageButton: document.getElementById('inspectorRemoveImageButton'),
  inspectorPresetCoverButton: document.getElementById('inspectorPresetCoverButton'),
  inspectorPresetContainButton: document.getElementById('inspectorPresetContainButton'),
  inspectorPresetTopButton: document.getElementById('inspectorPresetTopButton'),
  inspectorPresetCenterButton: document.getElementById('inspectorPresetCenterButton'),
  inspectorPresetBottomButton: document.getElementById('inspectorPresetBottomButton'),
  inspectorImageLockButton: document.getElementById('inspectorImageLockButton'),
  inspectorRedetectButton: document.getElementById('inspectorRedetectButton'),
  inspectorImageNudgeLeftButton: document.getElementById('inspectorImageNudgeLeftButton'),
  inspectorImageNudgeRightButton: document.getElementById('inspectorImageNudgeRightButton'),
  inspectorImageNudgeUpButton: document.getElementById('inspectorImageNudgeUpButton'),
  inspectorImageNudgeDownButton: document.getElementById('inspectorImageNudgeDownButton'),
  multiArrangeTools: document.getElementById('multiArrangeTools'),
  multiArrangeSummary: document.getElementById('multiArrangeSummary'),
  appActionButtons: Array.from(document.querySelectorAll('[data-app-action]')),
  layerTree: document.getElementById('layerTree'),
  layerFilterInput: document.getElementById('layerFilterInput'),
  preflightContainer: document.getElementById('preflightContainer'),
  preflightRefreshButton: document.getElementById('preflightRefreshButton'),
  assetTableWrap: document.getElementById('assetTableWrap'),
  assetFilterInput: document.getElementById('assetFilterInput'),
  relinkBrokenAssetsButton: document.getElementById('relinkBrokenAssetsButton'),
  refreshBrokenAssetsButton: document.getElementById('refreshBrokenAssetsButton'),
  brokenAssetList: document.getElementById('brokenAssetList'),
  brokenAssetRelinkSummary: document.getElementById('brokenAssetRelinkSummary'),
  relinkAssetInput: document.getElementById('relinkAssetInput'),
  runMarketLintButton: document.getElementById('runMarketLintButton'),
  marketLintList: document.getElementById('marketLintList'),
  contrastLintSummary: document.getElementById('contrastLintSummary'),
  contrastLintList: document.getElementById('contrastLintList'),
  runContrastLintButton: document.getElementById('runContrastLintButton'),
  previewFrame: document.getElementById('previewFrame'),
  editedCodeView: document.getElementById('editedCodeView'),
  normalizedCodeView: document.getElementById('normalizedCodeView'),
  originalCodeView: document.getElementById('originalCodeView'),
  jsonReportView: document.getElementById('jsonReportView'),
  projectMeta: document.getElementById('projectMeta'),
  documentStatusChip: document.getElementById('documentStatusChip'),
  statusText: document.getElementById('statusText'),
  localModeNotice: document.getElementById('localModeNotice'),
  textStyleSummary: document.getElementById('textStyleSummary'),
  textFontSizeInput: document.getElementById('textFontSizeInput'),
  textLineHeightInput: document.getElementById('textLineHeightInput'),
  textLetterSpacingInput: document.getElementById('textLetterSpacingInput'),
  textWeightSelect: document.getElementById('textWeightSelect'),
  textColorInput: document.getElementById('textColorInput'),
  textAlignSelect: document.getElementById('textAlignSelect'),
  applyTextStyleButton: document.getElementById('applyTextStyleButton'),
  clearTextStyleButton: document.getElementById('clearTextStyleButton'),
  batchSelectionSummary: document.getElementById('batchSelectionSummary'),
  geometryXInput: document.getElementById('geometryXInput'),
  geometryYInput: document.getElementById('geometryYInput'),
  geometryWInput: document.getElementById('geometryWInput'),
  geometryHInput: document.getElementById('geometryHInput'),
  geometryCoordModeSelect: document.getElementById('geometryCoordModeSelect'),
  geometryRuleHint: document.getElementById('geometryRuleHint'),
  applyGeometryButton: document.getElementById('applyGeometryButton'),
  arrangeToggleHideButton: document.getElementById('arrangeToggleHideButton'),
  arrangeToggleLockButton: document.getElementById('arrangeToggleLockButton'),
  basicAttributeSection: document.getElementById('basicAttributeSection'),
  advancedAttributeSection: document.getElementById('advancedAttributeSection'),
  applyAdvancedSettingsButton: document.getElementById('applyAdvancedSettingsButton'),
  advancedSettingsState: document.getElementById('advancedSettingsState'),
  bringForwardButton: document.getElementById('bringForwardButton'),
  sendBackwardButton: document.getElementById('sendBackwardButton'),
  bringToFrontButton: document.getElementById('bringToFrontButton'),
  sendToBackButton: document.getElementById('sendToBackButton'),
  imageNudgeLeftButton: document.getElementById('imageNudgeLeftButton'),
  imageNudgeRightButton: document.getElementById('imageNudgeRightButton'),
  imageNudgeUpButton: document.getElementById('imageNudgeUpButton'),
  imageNudgeDownButton: document.getElementById('imageNudgeDownButton'),
  toggleLeftSidebarButton: document.getElementById('toggleLeftSidebarButton'),
  toggleRightSidebarButton: document.getElementById('toggleRightSidebarButton'),
  focusModeButton: document.getElementById('focusModeButton'),
  workflowGuideSelect: document.getElementById('workflowGuideSelect'),
  workflowGuideLine: document.getElementById('workflowGuideLine'),
  zoomOutButton: document.getElementById('zoomOutButton'),
  zoomInButton: document.getElementById('zoomInButton'),
  zoomResetButton: document.getElementById('zoomResetButton'),
  zoomFitButton: document.getElementById('zoomFitButton'),
  zoomLabel: document.getElementById('zoomLabel'),
  previewViewport: document.getElementById('previewViewport'),
  previewScaler: document.getElementById('previewScaler'),
  canvasContextBar: document.getElementById('canvasContextBar'),
  canvasQuickbarMore: document.getElementById('canvasQuickbarMore'),
  miniHud: document.getElementById('miniHud'),
  miniHudPos: document.getElementById('miniHudPos'),
  miniHudSize: document.getElementById('miniHudSize'),
  miniHudLayer: document.getElementById('miniHudLayer'),
  canvasGeometryXInput: document.getElementById('canvasGeometryXInput'),
  canvasGeometryYInput: document.getElementById('canvasGeometryYInput'),
  canvasGeometryWInput: document.getElementById('canvasGeometryWInput'),
  canvasGeometryHInput: document.getElementById('canvasGeometryHInput'),
  applyCanvasGeometryButton: document.getElementById('applyCanvasGeometryButton'),
  codeEditorTextarea: document.getElementById('codeEditorTextarea'),
  codeSearchInput: document.getElementById('codeSearchInput'),
  codeSearchNextButton: document.getElementById('codeSearchNextButton'),
  codeValidateButton: document.getElementById('codeValidateButton'),
  codeJumpFirstChangeButton: document.getElementById('codeJumpFirstChangeButton'),
  codeJumpTopButton: document.getElementById('codeJumpTopButton'),
  codeDraftBadge: document.getElementById('codeDraftBadge'),
  codeCursorInfo: document.getElementById('codeCursorInfo'),
  codeSyncStats: document.getElementById('codeSyncStats'),
  codeDiffSummary: document.getElementById('codeDiffSummary'),
  codeValidationList: document.getElementById('codeValidationList'),
  codeCompareBaseSelect: document.getElementById('codeCompareBaseSelect'),
  codeCompareTargetSelect: document.getElementById('codeCompareTargetSelect'),
  codeCompareSwapButton: document.getElementById('codeCompareSwapButton'),
  codeCompareSummary: document.getElementById('codeCompareSummary'),
  codeComparePresetButtons: Array.from(document.querySelectorAll('[data-code-compare-preset]')),
  codeComparePresetSelect: document.getElementById('codeComparePresetSelect'),
  applyCodeComparePresetButton: document.getElementById('applyCodeComparePresetButton'),
  codeCompareIssuesOnlyButton: document.getElementById('codeCompareIssuesOnlyButton'),
  codeCompareColorOnlyButton: document.getElementById('codeCompareColorOnlyButton'),
  codeApplyImpactSummary: document.getElementById('codeApplyImpactSummary'),
  codeCompareList: document.getElementById('codeCompareList'),
  reloadCodeFromEditorButton: document.getElementById('reloadCodeFromEditorButton'),
  applyCodeToEditorButton: document.getElementById('applyCodeToEditorButton'),
  safeApplyCodeButton: document.getElementById('safeApplyCodeButton'),
  syncCodeFromCanvasQuickButton: document.getElementById('syncCodeFromCanvasQuickButton'),
  applyCodeFromPanelButton: document.getElementById('applyCodeFromPanelButton'),
  openCodeWorkbenchButton: document.getElementById('openCodeWorkbenchButton'),
  codeFlowState: document.getElementById('codeFlowState'),
  styleColorScopeSelect: document.getElementById('styleColorScopeSelect'),
  styleColorSummary: document.getElementById('styleColorSummary'),
  styleColorList: document.getElementById('styleColorList'),
  refreshStyleColorButton: document.getElementById('refreshStyleColorButton'),
  applyStyleColorButton: document.getElementById('applyStyleColorButton'),
  cssTokenList: document.getElementById('cssTokenList'),
  refreshCssTokenButton: document.getElementById('refreshCssTokenButton'),
  applyCssTokenButton: document.getElementById('applyCssTokenButton'),
  designTokenSummary: document.getElementById('designTokenSummary'),
  designTokenList: document.getElementById('designTokenList'),
  refreshDesignTokenButton: document.getElementById('refreshDesignTokenButton'),
  applyDesignTokenButton: document.getElementById('applyDesignTokenButton'),
  inlineColorExtractSummary: document.getElementById('inlineColorExtractSummary'),
  inlineColorExtractList: document.getElementById('inlineColorExtractList'),
  refreshInlineColorExtractButton: document.getElementById('refreshInlineColorExtractButton'),
  extractInlineColorVarsButton: document.getElementById('extractInlineColorVarsButton'),
  sectionThemePaletteSummary: document.getElementById('sectionThemePaletteSummary'),
  sectionThemePaletteList: document.getElementById('sectionThemePaletteList'),
  refreshSectionThemeButton: document.getElementById('refreshSectionThemeButton'),
  applySectionThemeButton: document.getElementById('applySectionThemeButton'),
  generateSlotSchemaButton: document.getElementById('generateSlotSchemaButton'),
  slotSchemaSummary: document.getElementById('slotSchemaSummary'),
  themeStudioBadge: document.getElementById('themeStudioBadge'),
  themeStudioSummary: document.getElementById('themeStudioSummary'),
  themeStudioFlowState: document.getElementById('themeStudioFlowState'),
  themeStudioApplyHint: document.getElementById('themeStudioApplyHint'),
  themeStudioCompareSummary: document.getElementById('themeStudioCompareSummary'),
  themeStudioModeButtons: Array.from(document.querySelectorAll('[data-theme-studio-mode]')),
  themeStudioColorsMount: document.getElementById('themeStudioColorsMount'),
  themeStudioTokensMount: document.getElementById('themeStudioTokensMount'),
  themeStudioLintMount: document.getElementById('themeStudioLintMount'),
  themeStudioApplyMount: document.getElementById('themeStudioApplyMount'),
  themeStudioRefreshVisibleButton: document.getElementById('themeStudioRefreshVisibleButton'),
  themeStudioRunChecksButton: document.getElementById('themeStudioRunChecksButton'),
  themeStudioSafeApplyButton: document.getElementById('themeStudioSafeApplyButton'),
  themeStudioOpenCodeButton: document.getElementById('themeStudioOpenCodeButton'),
  themeStudioSyncCodeButton: document.getElementById('themeStudioSyncCodeButton'),
  themeStudioApplyCodeButton: document.getElementById('themeStudioApplyCodeButton'),
  themeStudioComparePresetSelect: document.getElementById('themeStudioComparePresetSelect'),
  themeStudioApplyComparePresetButton: document.getElementById('themeStudioApplyComparePresetButton'),
  themeStudioIssuesOnlyButton: document.getElementById('themeStudioIssuesOnlyButton'),
  themeStudioColorDiffButton: document.getElementById('themeStudioColorDiffButton'),
  toggleImageLockButton: document.getElementById('toggleImageLockButton'),
  cropFloatingChip: document.getElementById('cropFloatingChip'),
  cropFloatingHint: document.getElementById('cropFloatingHint'),
  cropFloatingMeta: document.getElementById('cropFloatingMeta'),
  cropLockBadge: document.getElementById('cropLockBadge'),
  cropControlStrip: document.getElementById('cropControlStrip'),
  cropZoomSlider: document.getElementById('cropZoomSlider'),
  cropZoomValue: document.getElementById('cropZoomValue'),
  cropPresetFitButton: document.getElementById('cropPresetFitButton'),
  cropPresetCoverButton: document.getElementById('cropPresetCoverButton'),
  cropPresetActualButton: document.getElementById('cropPresetActualButton'),
  cropPresetResetButton: document.getElementById('cropPresetResetButton'),
  canvasQuickbarPrimary: document.getElementById('canvasQuickbarPrimary'),
  canvasQuickbarSecondary: document.getElementById('canvasQuickbarSecondary'),
  imagePresetSelect: document.getElementById('imagePresetSelect'),
  applyImagePresetButton: document.getElementById('applyImagePresetButton'),
  removeImageActionButton: document.getElementById('removeImageActionButton'),
  sectionThumbnailPresetSelect: document.getElementById('sectionThumbnailPresetSelect'),
  previewMinimap: document.getElementById('previewMinimap'),
  previewMinimapTrack: document.getElementById('previewMinimapTrack'),
  previewMinimapViewportRect: document.getElementById('previewMinimapViewportRect'),
  codeSourceButtons: Array.from(document.querySelectorAll('[data-code-source]')),
  sidebarTabButtons: Array.from(document.querySelectorAll('[data-sidebar-tab]')),
  sidebarPanels: Array.from(document.querySelectorAll('[data-sidebar-panel]')),
  viewSnapToggleButton: document.getElementById('viewSnapToggleButton'),
  viewGuideToggleButton: document.getElementById('viewGuideToggleButton'),
  viewRulerToggleButton: document.getElementById('viewRulerToggleButton'),
  settingsSnapToggleButton: document.getElementById('settingsSnapToggleButton'),
  settingsGuideToggleButton: document.getElementById('settingsGuideToggleButton'),
  settingsRulerToggleButton: document.getElementById('settingsRulerToggleButton'),
  settingsShortcutHelpButton: document.getElementById('settingsShortcutHelpButton'),
  settingsBeginnerModeButton: document.getElementById('settingsBeginnerModeButton'),
  settingsQaChecklistButton: document.getElementById('settingsQaChecklistButton'),
  qaChecklistModal: document.getElementById('qaChecklistModal'),
  closeQaChecklistButton: document.getElementById('closeQaChecklistButton'),
  qaChecklistContent: document.getElementById('qaChecklistContent'),
  selectionModeButtons: Array.from(document.querySelectorAll('[data-selection-mode]')),
  presetButtons: Array.from(document.querySelectorAll('[data-preset]')),
  actionButtons: Array.from(document.querySelectorAll('[data-action]')),
  batchActionButtons: Array.from(document.querySelectorAll('[data-batch-action]')),
  textAlignButtons: Array.from(document.querySelectorAll('[data-text-align]')),
  canvasActionButtons: Array.from(document.querySelectorAll('[data-canvas-action]')),
  shortcutHelpOverlay: document.getElementById('shortcutHelpOverlay'),
  shortcutHelpList: document.getElementById('shortcutHelpList'),
  shortcutHelpCloseButton: document.getElementById('shortcutHelpCloseButton'),
  commandPaletteOverlay: document.getElementById('commandPaletteOverlay'),
  commandPaletteCloseButton: document.getElementById('commandPaletteCloseButton'),
  commandPaletteInput: document.getElementById('commandPaletteInput'),
  commandPaletteList: document.getElementById('commandPaletteList'),
  commandPaletteRunButton: document.getElementById('commandPaletteRunButton'),
  stackDirectionSelect: document.getElementById('stackDirectionSelect'),
  stackGapInput: document.getElementById('stackGapInput'),
  stackAlignSelect: document.getElementById('stackAlignSelect'),
  stackApplyButton: document.getElementById('stackApplyButton'),
  tidyAxisSelect: document.getElementById('tidyAxisSelect'),
  tidyApplyButton: document.getElementById('tidyApplyButton'),
  batchActionSelect: document.getElementById('batchActionSelect'),
  applyBatchActionButton: document.getElementById('applyBatchActionButton'),
  stackHorizontalButton: document.getElementById('stackHorizontalButton'),
  stackVerticalButton: document.getElementById('stackVerticalButton'),
  tidyHorizontalButton: document.getElementById('tidyHorizontalButton'),
  tidyVerticalButton: document.getElementById('tidyVerticalButton'),
  beginnerMoreItems: Array.from(document.querySelectorAll('[data-beginner-more-item]')),
  beginnerModeToggle: document.getElementById('beginnerModeToggle'),
  beginnerMoreItems: Array.from(document.querySelectorAll('[data-beginner-more-item]')),
  advancedTopbarPanel: document.getElementById('advancedTopbarPanel'),
  beginnerTutorialTooltip: document.getElementById('beginnerTutorialTooltip'),
  beginnerTutorialTitle: document.getElementById('beginnerTutorialTitle'),
  beginnerTutorialBody: document.getElementById('beginnerTutorialBody'),
  beginnerTutorialStep: document.getElementById('beginnerTutorialStep'),
  beginnerTutorialPrevButton: document.getElementById('beginnerTutorialPrevButton'),
  beginnerTutorialNextButton: document.getElementById('beginnerTutorialNextButton'),
  beginnerTutorialCloseButton: document.getElementById('beginnerTutorialCloseButton'),
  onboardingReplayButton: document.getElementById('onboardingReplayButton'),
  onboardingChecklist: document.getElementById('onboardingChecklist'),
  onboardingChecklistItem: document.getElementById('onboardingChecklistItem'),
  onboardingChecklistDoneButton: document.getElementById('onboardingChecklistDoneButton'),
  beginnerMoreItems: Array.from(document.querySelectorAll('[data-beginner-more-item]')),
};

const beginnerMoreItemAnchors = new WeakMap();

for (const item of elements.beginnerMoreItems || []) {
  beginnerMoreItemAnchors.set(item, {
    parent: item.parentElement,
    nextSibling: item.nextSibling,
  });
}

function readFromLocalStorage(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeToLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function normalizeSectionThumbnailPreset(value) {
  return ['auto', 'fast', 'balanced', 'detail'].includes(String(value || '').trim()) ? String(value).trim() : 'auto';
}

function getSectionThumbnailRenderOptions(editorMeta = store.getState().editorMeta, uid = '') {
  const preset = normalizeSectionThumbnailPreset(currentSectionThumbnailPreset);
  const sectionCount = Number(editorMeta?.sections?.length || 0);
  const currentUid = getViewportFocusedSectionUid(editorMeta);
  const selectedSet = new Set(getSectionPanelSelection(editorMeta));
  const isPriority = uid && (uid === currentUid || uid === hoveredSectionPreviewUid || selectedSet.has(uid));
  if (preset === 'fast') return { preset, useScreenshot: false, maxWidth: 168, maxHeight: 108 };
  if (preset === 'detail') return { preset, useScreenshot: true, maxWidth: 320, maxHeight: 206 };
  if (preset === 'balanced') return { preset, useScreenshot: true, maxWidth: 224, maxHeight: 144 };
  if (sectionCount >= 24) {
    return isPriority ? { preset, useScreenshot: true, maxWidth: 208, maxHeight: 132 } : { preset, useScreenshot: false, maxWidth: 160, maxHeight: 102 };
  }
  if (sectionCount >= 14) {
    return isPriority ? { preset, useScreenshot: true, maxWidth: 224, maxHeight: 144 } : { preset, useScreenshot: true, maxWidth: 176, maxHeight: 112 };
  }
  return { preset, useScreenshot: true, maxWidth: 224, maxHeight: 144 };
}

function buildQaChecklistHtml() {
  return QA_CHECKLIST_ITEMS.map((section) => `
    <section class="qa-checklist__group">
      <h3>${escapeHtml(section.group)}</h3>
      <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>
  `).join('');
}

function setQaChecklistOpen(open) {
  if (!elements.qaChecklistModal) return;
  elements.qaChecklistModal.hidden = !open;
  if (open && elements.qaChecklistContent && !elements.qaChecklistContent.dataset.ready) {
    elements.qaChecklistContent.innerHTML = buildQaChecklistHtml();
    elements.qaChecklistContent.dataset.ready = '1';
  }
}

function hasCompletedOnboarding() {
  return readFromLocalStorage(ONBOARDING_COMPLETED_STORAGE_KEY, '') === '1';
}

function hasCompletedOnboardingSampleTask() {
  return readFromLocalStorage(ONBOARDING_SAMPLE_CHECKED_STORAGE_KEY, '') === '1';
}

function markOnboardingCompleted() {
  onboardingCompleted = true;
  writeToLocalStorage(ONBOARDING_COMPLETED_STORAGE_KEY, '1');
}

function clearOnboardingHighlights() {
  document.querySelectorAll('.onboarding-highlight').forEach((target) => target.classList.remove('onboarding-highlight'));
}

function applyOnboardingHighlightForCurrentStep() {
  clearOnboardingHighlights();
  if (onboardingCompleted) return;
  const step = BEGINNER_TUTORIAL_STEPS[beginnerTutorialStepIndex] || null;
  const target = step?.targetElementKey ? elements[step.targetElementKey] : null;
  target?.classList.add('onboarding-highlight');
}

function closeBeginnerTutorial() {
  if (elements.beginnerTutorialTooltip) elements.beginnerTutorialTooltip.hidden = true;
  clearOnboardingHighlights();
}

function renderOnboardingChecklist() {
  if (!elements.onboardingChecklist) return;
  const done = hasCompletedOnboardingSampleTask();
  elements.onboardingChecklist.hidden = !onboardingCompleted;
  if (elements.onboardingChecklistItem) {
    elements.onboardingChecklistItem.textContent = done
      ? '✅ 샘플 작업 1회 실행 완료'
      : '⬜ 샘플(F05)에서 슬롯 선택 → 이미지 교체 → PNG 저장을 1회 실행해 보세요.';
  }
  if (elements.onboardingChecklistDoneButton) {
    elements.onboardingChecklistDoneButton.disabled = done;
    elements.onboardingChecklistDoneButton.textContent = done ? '체크 완료' : '완료 체크';
  }
}

function renderBeginnerTutorialStep() {
  const step = BEGINNER_TUTORIAL_STEPS[beginnerTutorialStepIndex] || BEGINNER_TUTORIAL_STEPS[0];
  if (elements.beginnerTutorialTitle) elements.beginnerTutorialTitle.textContent = step.title;
  if (elements.beginnerTutorialBody) elements.beginnerTutorialBody.textContent = step.body;
  if (elements.beginnerTutorialStep) elements.beginnerTutorialStep.textContent = `${beginnerTutorialStepIndex + 1} / ${BEGINNER_TUTORIAL_STEPS.length}`;
  if (elements.beginnerTutorialPrevButton) elements.beginnerTutorialPrevButton.disabled = beginnerTutorialStepIndex < 1;
  if (elements.beginnerTutorialNextButton) {
    const isLast = beginnerTutorialStepIndex >= BEGINNER_TUTORIAL_STEPS.length - 1;
    elements.beginnerTutorialNextButton.textContent = isLast ? '완료' : '다음';
  }
  applyOnboardingHighlightForCurrentStep();
}

function openBeginnerTutorial({ force = false } = {}) {
  if (!force && onboardingCompleted) return;
  beginnerTutorialStepIndex = 0;
  renderBeginnerTutorialStep();
  if (elements.beginnerTutorialTooltip) elements.beginnerTutorialTooltip.hidden = false;
}

function openBeginnerTutorialIfNeeded() {
  if (onboardingCompleted) return;
  openBeginnerTutorial();
}

function completeOnboardingTutorial() {
  markOnboardingCompleted();
  closeBeginnerTutorial();
  renderOnboardingChecklist();
  setStatus('온보딩을 완료했습니다. 아래 체크리스트로 샘플 작업을 1회 실행해 보세요.');
}

function advanceOnboardingByAction(actionId) {
  if (onboardingCompleted || elements.beginnerTutorialTooltip?.hidden) return;
  const step = BEGINNER_TUTORIAL_STEPS[beginnerTutorialStepIndex] || null;
  if (!step || step.id !== actionId) return;
  if (beginnerTutorialStepIndex >= BEGINNER_TUTORIAL_STEPS.length - 1) {
    completeOnboardingTutorial();
    return;
  }
  beginnerTutorialStepIndex += 1;
  renderBeginnerTutorialStep();
}

function applyBeginnerModeUi() {
  document.body.classList.toggle('beginner-mode', isBeginnerMode);
  if (elements.beginnerModeToggle) {
    elements.beginnerModeToggle.textContent = `초보 모드: ${isBeginnerMode ? 'ON' : 'OFF'}`;
    elements.beginnerModeToggle.setAttribute('aria-pressed', isBeginnerMode ? 'true' : 'false');
  }
  if (isBeginnerMode && elements.advancedTopbarPanel) elements.advancedTopbarPanel.open = false;
}

function setBeginnerMode(next, { silent = false } = {}) {
  isBeginnerMode = !!next;
  applyBeginnerModeUi();
  writeToLocalStorage(BEGINNER_MODE_STORAGE_KEY, isBeginnerMode ? '1' : '0');
  if (!silent) setStatus(`초보 모드를 ${isBeginnerMode ? '켰습니다' : '껐습니다'}.`);
}

function evaluateWorkflowStepReadiness(step, state) {
  const hasProject = !!state?.project;
  const hasEditor = !!activeEditor;
  const selectionCount = Number(state?.editorMeta?.selectionCount || 0);
  if (step === 'edit' && !hasProject) {
    return { ok: false, message: '[단계 안내] 2) 편집으로 가기 전, 1) 불러오기에서 HTML/폴더를 먼저 열어 주세요.' };
  }
  if (step === 'save' && (!hasProject || !hasEditor)) {
    return { ok: false, message: '[단계 안내] 3) 저장/출력 전, 1) 불러오기와 2) 편집 준비가 필요합니다.' };
  }
  if (step === 'save' && selectionCount < 1) {
    return { ok: true, message: '[단계 안내] 선택 요소가 없습니다. 전체 저장/출력은 가능하며, 선택 PNG는 요소를 선택한 뒤 사용하세요.' };
  }
  return { ok: true, message: '' };
}

function syncWorkflowGuide(state, { announce = false } = {}) {
  const selectedStep = elements.workflowGuideSelect?.value || 'load';
  if (elements.workflowGuideLine) {
    elements.workflowGuideLine.textContent = WORKFLOW_STEP_GUIDES[selectedStep] || WORKFLOW_STEP_GUIDES.load;
  }
  if (announce) {
    const check = evaluateWorkflowStepReadiness(selectedStep, state);
    if (check.message) setStatus(check.message);
  }
}

function syncWorkflowGuideStepByLeftTab(leftTabId, { announce = false } = {}) {
  const mappedStep = LEFT_TAB_TO_WORKFLOW_STEP[String(leftTabId || '')];
  if (!mappedStep) return;
  if (elements.workflowGuideSelect && elements.workflowGuideSelect.value !== mappedStep) {
    elements.workflowGuideSelect.value = mappedStep;
  }
  syncWorkflowGuide(store.getState(), { announce });
}

function resolveDocumentStatus(state) {
  if (!state?.project || !activeEditor) return { status: 'idle', text: '문서 없음' };
  if (state.lastError) return { status: 'error', text: '오류 있음' };
  if (codeEditorDirty || advancedSettingsDirty || historyState.undoStack.length > 0) return { status: 'dirty', text: '편집 중' };
  return { status: 'ready', text: '저장 가능' };
}

function projectBaseName(project) {
  return sanitizeFilename((project?.sourceName || 'detail-page').replace(/\.html?$/i, '') || 'detail-page');
}

function exportScale() {
  const value = Number.parseFloat(String(advancedSettings.exportScale || 1));
  if (!Number.isFinite(value)) return 1;
  if (value >= 2.5) return 3;
  if (value >= 1.5) return 2;
  return 1;
}

function exportJpgQuality() {
  const raw = Number.parseFloat(String(advancedSettings.exportJpgQuality || DEFAULT_JPG_QUALITY));
  if (!Number.isFinite(raw)) return DEFAULT_JPG_QUALITY;
  return Math.min(1, Math.max(0.1, raw));
}

function selectionExportPadding() {
  const raw = Number.parseFloat(String(advancedSettings.selectionExportPadding || 16));
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(240, Math.round(raw)));
}

function selectionExportBackground() {
  const raw = String(advancedSettings.selectionExportBackground || 'transparent');
  return raw === 'opaque' ? 'opaque' : 'transparent';
}

function setStatus(text, options = undefined) {
  store.setStatus(text, options);
}

function setImageApplyDiagnostic(diagnostic) {
  store.setImageApplyDiagnostic(diagnostic || null);
}

function buildImageFailureDiagnostic({ files = [], editorMeta = null, statusMessage = '' } = {}) {
  const firstFile = files[0] || null;
  const fileName = firstFile?.name || '';
  const selected = editorMeta?.selected || null;
  const selectedSlotLike = !!selected && (selected.type === 'slot' || selected.detectedType === 'slot');
  const selectedSlotLabel = selected?.label || selected?.uid || '';
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
  const unsupportedByExtension = !!extension && !SUPPORTED_IMAGE_EXTENSIONS.includes(extension);
  const unsupportedByMime = !!firstFile && !!firstFile.type && !String(firstFile.type).startsWith('image/');
  const unsupportedFormat = unsupportedByExtension || unsupportedByMime;
  const filenameMismatch = !!fileName && !!selectedSlotLabel && !fileName.toLowerCase().includes(String(selectedSlotLabel).toLowerCase());
  const slotUnselected = !selectedSlotLike;

  return {
    status: 'failed',
    message: statusMessage || '이미지 적용 실패 원인을 확인해 주세요.',
    reasons: {
      slotUnselected,
      filenameMismatch,
      unsupportedFormat,
    },
    details: {
      slotUnselected: slotUnselected ? '이미지를 적용할 슬롯을 먼저 선택해 주세요.' : '선택된 슬롯이 있습니다.',
      filenameMismatch: filenameMismatch
        ? `선택 슬롯(${selectedSlotLabel})과 파일명(${fileName})이 다릅니다.`
        : '필요하면 파일명에 슬롯 이름 일부를 포함해 자동 매칭 정확도를 높이세요.',
      unsupportedFormat: unsupportedFormat
        ? `지원하지 않는 이미지 형식입니다. 파일명 확장자: ${extension || 'unknown'}, MIME: ${firstFile?.type || 'unknown'}`
        : '이미지 파일 형식입니다.',
    },
  };
}

function setAppState(nextState) {
  const normalized = nextState === APP_STATES.editor ? APP_STATES.editor : APP_STATES.launch;
  currentAppState = normalized;
  const isEditor = normalized === APP_STATES.editor;
  if (elements.appLauncher) elements.appLauncher.hidden = isEditor;
  if (elements.appShell) elements.appShell.hidden = !isEditor;
  if (elements.appStatusbar) elements.appStatusbar.hidden = true;
  if (isEditor) syncWorkspaceButtons();
}

function refreshLauncherRecentButton() {
  if (!elements.launcherRecentButton) return;
  const payload = readAutosavePayload();
  const hasSnapshot = !!payload?.snapshot?.html;
  elements.launcherRecentButton.disabled = false;
  elements.launcherRecentButton.dataset.available = hasSnapshot ? 'true' : 'false';
}

function extractErrorMessage(error) {
  if (!error) return '';
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '';
}

function setStatusWithError(prefix, error, { logTag = 'APP_ERROR' } = {}) {
  const detail = extractErrorMessage(error);
  if (logTag) console.error(`[${logTag}]`, error);
  store.setLastError(detail);
  setStatus(prefix, { preserveLastError: true });
}

function isTypingInputTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('[contenteditable="true"]')) return true;
  const tagName = target.tagName;
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName !== 'INPUT') return false;
  const inputType = String(target.getAttribute('type') || 'text').toLowerCase();
  return inputType !== 'checkbox' && inputType !== 'radio' && inputType !== 'button' && inputType !== 'submit' && inputType !== 'reset';
}

function toggleShortcutHelp(forceOpen = null) {
  const overlay = elements.shortcutHelpOverlay;
  if (!overlay) return false;
  const shouldOpen = forceOpen == null ? overlay.hidden : !!forceOpen;
  overlay.hidden = !shouldOpen;
  if (shouldOpen) {
    lastFocusedBeforeShortcutHelp = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.shortcutHelpCloseButton?.focus();
    setStatus('단축키 치트시트를 열었습니다.');
  } else if (lastFocusedBeforeShortcutHelp && typeof lastFocusedBeforeShortcutHelp.focus === 'function') {
    lastFocusedBeforeShortcutHelp.focus();
  }
  return shouldOpen;
}

function getDownloadModalFocusable() {
  if (!elements.downloadModal) return [];
  return Array.from(elements.downloadModal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
    .filter((node) => node instanceof HTMLElement && !node.disabled && !node.hidden && node.tabIndex >= 0);
}

function toggleDownloadModal(forceOpen = null) {
  const overlay = elements.downloadModal;
  if (!overlay) return false;
  const shouldOpen = forceOpen == null ? overlay.hidden : !!forceOpen;
  overlay.hidden = !shouldOpen;
  if (shouldOpen) {
    lastFocusedBeforeDownloadModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.downloadChoiceSelect?.focus();
    setStatus('저장/출력 모달을 열었습니다.');
  } else if (lastFocusedBeforeDownloadModal && typeof lastFocusedBeforeDownloadModal.focus === 'function') {
    lastFocusedBeforeDownloadModal.focus();
  }
  return shouldOpen;
}

function handleDownloadModalFocusTrap(event) {
  if (!elements.downloadModal || elements.downloadModal.hidden || event.key !== 'Tab') return;
  const focusable = getDownloadModalFocusable();
  if (focusable.length < 1) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function applyShortcutTooltips() {
  for (const [selector, label] of Object.entries(SHORTCUT_TOOLTIP_MAP)) {
    for (const node of Array.from(document.querySelectorAll(selector))) {
      node.title = label;
      const originalAria = node.getAttribute('aria-label') || node.textContent?.trim() || '';
      if (!originalAria.includes('(')) node.setAttribute('aria-label', `${originalAria} ${label.match(/\(.+\)/)?.[0] || ''}`.trim());
    }
  }
}

function renderShortcutHelpList() {
  if (!elements.shortcutHelpList) return;
  elements.shortcutHelpList.innerHTML = '';
  for (const item of COMMAND_REGISTRY) {
    if (!item.shortcut || item.shortcut === '-') continue;
    const li = document.createElement('li');
    const kbd = document.createElement('kbd');
    kbd.textContent = item.shortcut;
    const label = document.createElement('span');
    label.textContent = item.label;
    li.append(kbd, label);
    elements.shortcutHelpList.append(li);
  }
}

function getCommandPaletteFocusable() {
  if (!elements.commandPaletteOverlay) return [];
  return Array.from(elements.commandPaletteOverlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
    .filter((node) => node instanceof HTMLElement && !node.disabled && !node.hidden && node.tabIndex >= 0);
}

function handleCommandPaletteFocusTrap(event) {
  if (!elements.commandPaletteOverlay || elements.commandPaletteOverlay.hidden || event.key !== 'Tab') return;
  const focusable = getCommandPaletteFocusable();
  if (focusable.length < 1) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function performCommandAction(commandId) {
  const command = COMMAND_REGISTRY.find((item) => item.id === commandId);
  if (!command) return { ok: false, message: '명령을 찾지 못했습니다.' };
  const result = command.run?.() || { ok: false, message: '명령 실행기를 찾지 못했습니다.' };
  if (result?.message) setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  return result;
}

function filterCommandPalette(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [...COMMAND_REGISTRY];
  return COMMAND_REGISTRY.filter((item) => {
    const target = [item.label, item.shortcut, ...(item.keywords || [])].join(' ').toLowerCase();
    return target.includes(normalized);
  });
}

function renderCommandPaletteResults() {
  if (!elements.commandPaletteList) return;
  elements.commandPaletteList.innerHTML = '';
  if (!commandPaletteResults.length) {
    const li = document.createElement('li');
    li.className = 'command-palette__item';
    li.textContent = '검색 결과가 없습니다.';
    elements.commandPaletteList.append(li);
    return;
  }
  commandPaletteActiveIndex = Math.max(0, Math.min(commandPaletteActiveIndex, commandPaletteResults.length - 1));
  commandPaletteResults.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `command-palette__item${index === commandPaletteActiveIndex ? ' is-active' : ''}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', index === commandPaletteActiveIndex ? 'true' : 'false');
    li.dataset.commandId = item.id;
    li.innerHTML = `<strong>${item.label}</strong><span class="topbar__sub">${item.shortcut || '-'}</span>`;
    li.addEventListener('click', () => {
      commandPaletteActiveIndex = index;
      runActiveCommandPaletteItem();
    });
    elements.commandPaletteList.append(li);
  });
}

function runActiveCommandPaletteItem() {
  const selected = commandPaletteResults[commandPaletteActiveIndex];
  if (!selected) return;
  const result = performCommandAction(selected.id);
  if (result?.ok) toggleCommandPalette(false);
}

function updateCommandPaletteResults() {
  commandPaletteResults = filterCommandPalette(elements.commandPaletteInput?.value || '');
  commandPaletteActiveIndex = 0;
  renderCommandPaletteResults();
}

function toggleCommandPalette(forceOpen = null) {
  const overlay = elements.commandPaletteOverlay;
  if (!overlay) return false;
  const shouldOpen = forceOpen == null ? overlay.hidden : !!forceOpen;
  overlay.hidden = !shouldOpen;
  if (shouldOpen) {
    lastFocusedBeforeCommandPalette = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (elements.commandPaletteInput) {
      elements.commandPaletteInput.value = '';
      updateCommandPaletteResults();
      elements.commandPaletteInput.focus();
    }
    setStatus('명령 팔레트를 열었습니다. 검색 후 Enter를 누르세요.');
  } else if (lastFocusedBeforeCommandPalette && typeof lastFocusedBeforeCommandPalette.focus === 'function') {
    lastFocusedBeforeCommandPalette.focus();
  }
  return shouldOpen;
}

function evaluateLocalBootEnvironment() {
  const checks = [];
  const add = (level, code, message) => checks.push({ level, code, message });
  const protocol = window.location?.protocol || '';

  if (protocol !== 'file:') {
    add('warning', 'NOT_FILE_PROTOCOL', `현재 실행 경로가 ${protocol || '(알 수 없음)'} 입니다. 필수 기준은 file:// 직접 실행입니다.`);
  }
  if (BOOT_LOCAL_POLICY.requiresStartupFetch) {
    add('error', 'POLICY_BOOT_FETCH', '초기 부팅 경로가 fetch/network를 필수로 요구하도록 설정되어 있습니다.');
  }
  if (BOOT_LOCAL_POLICY.requiresFileSystemAccessApi) {
    add('error', 'POLICY_FS_ACCESS_REQUIRED', 'File System Access API를 필수 경로로 요구하도록 설정되어 있습니다.');
  }
  if (BOOT_LOCAL_POLICY.requiresServerEndpoint) {
    add('error', 'POLICY_SERVER_REQUIRED', '서버/도메인 의존 경로가 필수로 설정되어 있습니다.');
  }
  if (typeof window.FileReader !== 'function') {
    add('error', 'MISSING_FILE_READER', '이 브라우저는 FileReader를 지원하지 않아 로컬 파일 import가 동작하지 않습니다.');
  }
  if (typeof URL?.createObjectURL !== 'function') {
    add('error', 'MISSING_BLOB_URL', '이 브라우저는 Blob URL 미리보기를 지원하지 않습니다.');
  }
  if (typeof window.DOMParser !== 'function') {
    add('error', 'MISSING_DOM_PARSER', '이 브라우저는 DOMParser를 지원하지 않아 HTML 파싱 기능이 제한됩니다.');
  }
  if (!('localStorage' in window)) {
    add('warning', 'NO_LOCAL_STORAGE', 'localStorage를 사용할 수 없어 autosave 복구 기능이 제한될 수 있습니다.');
  }

  return {
    generatedAt: new Date().toISOString(),
    checks,
    errorCount: checks.filter((item) => item.level === 'error').length,
    warningCount: checks.filter((item) => item.level === 'warning').length,
  };
}

function populateFixtureSelect() {
  elements.fixtureSelect.innerHTML = FIXTURE_MANIFEST.fixtures
    .map((fixture) => `<option value="${fixture.id}">${fixture.id} · ${fixture.name}</option>`)
    .join('');
  elements.fixtureSelect.value = 'F05';
}

function populateExportPresetSelect() {
  elements.exportPresetSelect.innerHTML = EXPORT_PRESETS
    .map((preset) => `<option value="${preset.id}">${preset.label}</option>`)
    .join('');
  elements.exportPresetSelect.value = currentExportPresetId;
}

function currentExportPreset() {
  return getExportPresetById(currentExportPresetId);
}

function normalizeSaveFormat(value) {
  return value === 'embedded' ? 'embedded' : 'linked';
}

function formatByteSize(bytes) {
  const safeBytes = Number(bytes);
  if (!Number.isFinite(safeBytes) || safeBytes <= 0) return '0 B';
  if (safeBytes < 1024) return `${Math.round(safeBytes)} B`;
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function nextActionHint(kind) {
  return EXPORT_NEXT_ACTION_HINTS[kind] || '다음: 결과물을 열어 품질과 경로를 확인해 주세요.';
}

function notifySavedWithGuide(kind, fileName, detail = '') {
  const detailText = detail ? ` (${detail})` : '';
  setStatus(`저장 완료: ${fileName}${detailText} · ${nextActionHint(kind)}`);
}

function estimateSavePreview(project, format) {
  const sourceHtml = String(activeEditor?.getEditedHtml?.({ persistDetectedSlots: true }) || project?.normalizedHtml || '');
  const htmlBytes = new TextEncoder().encode(sourceHtml).length;
  const resolvedAssets = Number(project?.summary?.assetsResolved || 0);
  const unresolvedAssets = Number(project?.summary?.assetsUnresolved || 0);
  if (format === 'embedded') {
    return {
      fileCountLabel: '1개 (HTML 단일 파일)',
      sizeLabel: `예상 용량: ${formatByteSize(Math.round(htmlBytes * 1.3))} 내외`,
      pathPolicy: '경로 유지: 아니요 (이미지 data URL 내장)',
    };
  }
  return {
    fileCountLabel: `${1 + resolvedAssets}개 내외 (HTML 1 + 자산 ${resolvedAssets})`,
    sizeLabel: `예상 용량: ${formatByteSize(htmlBytes)} + 이미지 원본 합계`,
    pathPolicy: unresolvedAssets > 0 ? `경로 유지: 예 (단, 미해결 ${unresolvedAssets}개 경고 가능)` : '경로 유지: 예',
  };
}

function buildSaveMetaSummary() {
  if (!lastSaveConversion) return `리포트 save 메타: selectedFormat=${currentSaveFormat}, lastConversion=아직 없음`;
  const convertedCount = Number(lastSaveConversion.convertedDataUrlCount || 0);
  const generatedCount = Number(lastSaveConversion.generatedAssetCount || 0);
  const warningCount = Number(lastSaveConversion.brokenLinkedPathWarnings?.length || 0);
  const savedAt = lastSaveConversion.savedAt ? new Date(lastSaveConversion.savedAt).toLocaleString() : '시간 없음';
  return `리포트 save 메타: selectedFormat=${currentSaveFormat}, lastConversion=${lastSaveConversion.format || '-'} · dataURL→file ${convertedCount} · 생성자산 ${generatedCount} · 경고 ${warningCount} · ${savedAt}`;
}

function syncSaveFormatUi() {
  currentSaveFormat = normalizeSaveFormat(elements.saveFormatSelect?.value || currentSaveFormat);
  if (elements.saveFormatSelect && elements.saveFormatSelect.value !== currentSaveFormat) {
    elements.saveFormatSelect.value = currentSaveFormat;
  }
  if (elements.saveFormatStatus) {
    const modeLabel = currentSaveFormat === 'embedded' ? 'embedded 전달용 (data URL 내장)' : 'linked 표준 (가볍고 재편집 권장)';
    elements.saveFormatStatus.textContent = `현재 저장 포맷: ${modeLabel}`;
  }
  if (elements.saveFormatGuide) {
    const purposeGuide = currentSaveFormat === 'embedded'
      ? '추천 안내: 1파일 전달/메신저 공유는 embedded가 편하지만, 이미지가 많으면 무거워질 수 있습니다.'
      : '추천 안내: 기본 저장은 linked를 권장합니다. 편집 중 성능과 재편집 안정성이 훨씬 좋습니다.';
    elements.saveFormatGuide.textContent = purposeGuide;
  }
  if (elements.saveFormatPreview) {
    const preview = estimateSavePreview(store.getState().project, currentSaveFormat);
    elements.saveFormatPreview.textContent = `저장 결과 미리보기 → 파일 수: ${preview.fileCountLabel} · ${preview.sizeLabel} · ${preview.pathPolicy}`;
  }
  if (elements.saveMetaSummary) {
    elements.saveMetaSummary.textContent = buildSaveMetaSummary();
  }
}

function syncDownloadDensityUi() {
  const choice = elements.downloadChoiceSelect?.value || 'save-edited';
  const saveGrid = elements.saveFormatSelect?.closest('.download-modal__grid') || null;
  const optionsGrid = elements.selectionExportPaddingInput?.closest('.download-modal__options') || null;
  const advancedDetails = document.getElementById('downloadAdvancedDetails');
  const needsSaveFormat = ['save-edited', 'download-linked-zip', 'download-normalized-html'].includes(choice);
  const needsPreset = ['download-export-preset-package'].includes(choice);
  const needsScale = ['export-full-png', 'export-full-jpg', 'export-selection-png', 'download-export-preset-package'].includes(choice);
  const needsSelectionOptions = choice === 'export-selection-png';
  if (saveGrid) saveGrid.hidden = !(needsSaveFormat || needsPreset || needsScale);
  if (elements.saveFormatSelect?.closest('label')) elements.saveFormatSelect.closest('label').hidden = !needsSaveFormat;
  if (elements.exportPresetSelect?.closest('label')) elements.exportPresetSelect.closest('label').hidden = !needsPreset;
  if (elements.exportScaleSelectMain?.closest('label')) elements.exportScaleSelectMain.closest('label').hidden = !needsScale;
  if (elements.exportJpgQualityInputMain?.closest('label')) elements.exportJpgQualityInputMain.closest('label').hidden = choice !== 'export-full-jpg';
  if (optionsGrid) optionsGrid.hidden = !needsSelectionOptions;
  if (advancedDetails) advancedDetails.open = choice.startsWith('download-') && choice !== 'save-edited';
}

function markAdvancedSettingsDirty(isDirty) {
  advancedSettingsDirty = !!isDirty;
  if (!elements.advancedSettingsState) return;
  elements.advancedSettingsState.textContent = advancedSettingsDirty ? '고급값 변경됨 · 적용 필요' : '고급값 대기 없음';
}

function getFirstControlValue(controlList, fallbackValue) {
  const controls = Array.isArray(controlList) ? controlList : [];
  const firstControl = controls.find((control) => control);
  if (!firstControl) return fallbackValue;
  return firstControl.value;
}

function syncMirroredControls(controlList, nextValue, sourceControl = null) {
  const controls = Array.isArray(controlList) ? controlList : [];
  for (const control of controls) {
    if (!control || control === sourceControl) continue;
    if (control.value !== nextValue) control.value = nextValue;
  }
}

function syncAdvancedFormFromState() {
  if (elements.geometryCoordModeSelect) elements.geometryCoordModeSelect.value = advancedSettings.geometryCoordMode;
  for (const control of elements.exportScaleSelectControls) {
    if (control) control.value = String(advancedSettings.exportScale);
  }
  for (const control of elements.exportJpgQualityInputs) {
    if (control) control.value = String(advancedSettings.exportJpgQuality);
  }
  if (elements.selectionExportPaddingInput) elements.selectionExportPaddingInput.value = String(advancedSettings.selectionExportPadding);
  if (elements.selectionExportBackgroundSelect) elements.selectionExportBackgroundSelect.value = advancedSettings.selectionExportBackground;
  markAdvancedSettingsDirty(false);
}

function applyAdvancedSettingsFromForm() {
  const nextCoordMode = elements.geometryCoordModeSelect?.value === 'absolute' ? 'absolute' : 'relative';
  const nextScaleRaw = Number.parseFloat(getFirstControlValue(elements.exportScaleSelectControls, '1'));
  const nextScale = nextScaleRaw >= 2.5 ? 3 : (nextScaleRaw >= 1.5 ? 2 : 1);
  const nextJpgRaw = Number.parseFloat(getFirstControlValue(elements.exportJpgQualityInputs, String(DEFAULT_JPG_QUALITY)));
  const nextJpgQuality = Number.isFinite(nextJpgRaw) ? Math.min(1, Math.max(0.1, nextJpgRaw)) : DEFAULT_JPG_QUALITY;
  const nextPaddingRaw = Number.parseFloat(elements.selectionExportPaddingInput?.value || '16');
  const nextPadding = Number.isFinite(nextPaddingRaw) ? Math.max(0, Math.min(240, Math.round(nextPaddingRaw))) : 16;
  const nextBackground = elements.selectionExportBackgroundSelect?.value === 'opaque' ? 'opaque' : 'transparent';

  advancedSettings.geometryCoordMode = nextCoordMode;
  advancedSettings.exportScale = nextScale;
  advancedSettings.exportJpgQuality = nextJpgQuality;
  advancedSettings.selectionExportPadding = nextPadding;
  advancedSettings.selectionExportBackground = nextBackground;
  geometryCoordMode = nextCoordMode;
  syncGeometryControls();
  syncAdvancedFormFromState();
  return {
    ok: true,
    message: `고급값 적용 완료 (좌표 ${nextCoordMode}, 배율 ${nextScale}x, JPG ${nextJpgQuality.toFixed(2)})`,
  };
}

function applyAdvancedSettingsIfDirty() {
  if (!advancedSettingsDirty) return false;
  applyAdvancedSettingsFromForm();
  return true;
}

function readPanelLayoutState() {
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      basicOpen: parsed.basicOpen !== false,
      advancedOpen: parsed.advancedOpen === true,
    };
  } catch {
    return null;
  }
}

function persistPanelLayoutState() {
  try {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify({
      basicOpen: !!elements.basicAttributeSection?.open,
      advancedOpen: !!elements.advancedAttributeSection?.open,
    }));
  } catch {}
}

function restorePanelLayoutState() {
  const saved = readPanelLayoutState();
  if (!saved) return;
  if (elements.basicAttributeSection) elements.basicAttributeSection.open = saved.basicOpen;
  if (elements.advancedAttributeSection) elements.advancedAttributeSection.open = saved.advancedOpen;
}

function resolveSidebarTab(panelId) {
  const requested = String(panelId || '');
  const scope = requested.startsWith('left-')
    ? 'left'
    : (requested.startsWith('right-') ? 'right' : '');
  if (!scope) return '';
  const scopedButtons = elements.sidebarTabButtons.filter((button) => String(button.dataset.sidebarTab || '').startsWith(`${scope}-`));
  const scopedPanels = elements.sidebarPanels.filter((panel) => String(panel.dataset.sidebarPanel || '').startsWith(`${scope}-`));
  const hasRequestedButton = scopedButtons.some((button) => button.dataset.sidebarTab === requested);
  const hasRequestedPanel = scopedPanels.some((panel) => panel.dataset.sidebarPanel === requested);
  if (hasRequestedButton && hasRequestedPanel) return requested;
  const fallback = scopedButtons.find((button) => scopedPanels.some((panel) => panel.dataset.sidebarPanel === button.dataset.sidebarTab));
  return fallback?.dataset.sidebarTab || '';
}

function setSidebarTab(panelId, { syncWorkflow = true } = {}) {
  const targetPanelId = resolveSidebarTab(panelId);
  const scope = String(targetPanelId || '').startsWith('left-')
    ? 'left'
    : (String(targetPanelId || '').startsWith('right-') ? 'right' : '');
  if (!scope) return;
  for (const button of elements.sidebarTabButtons) {
    const buttonScope = String(button.dataset.sidebarTab || '').startsWith('left-')
      ? 'left'
      : (String(button.dataset.sidebarTab || '').startsWith('right-') ? 'right' : '');
    if (buttonScope !== scope) continue;
    button.classList.toggle('is-active', button.dataset.sidebarTab === targetPanelId);
  }
  for (const panel of elements.sidebarPanels) {
    const panelScope = String(panel.dataset.sidebarPanel || '').startsWith('left-')
      ? 'left'
      : (String(panel.dataset.sidebarPanel || '').startsWith('right-') ? 'right' : '');
    if (panelScope !== scope) continue;
    panel.classList.toggle('is-active', panel.dataset.sidebarPanel === targetPanelId);
  }
  if (scope === 'left' && syncWorkflow) syncWorkflowGuideStepByLeftTab(targetPanelId);
}

function getSlotRuntimeMeta(slotUid) {
  const doc = elements.previewFrame?.contentDocument;
  const slot = doc?.querySelector?.(`[data-node-uid="${slotUid}"]`);
  if (!slot) return { lastAppliedFileName: '', hasMedia: false };
  const img = slot.querySelector('img');
  const src = String(img?.getAttribute('src') || '').trim();
  const backgroundImage = String(slot.style?.backgroundImage || '').trim();
  const hasMedia = Boolean(
    (src && !src.startsWith('data:image/svg+xml') && !/placeholder/i.test(src))
    || (backgroundImage && backgroundImage !== 'none'),
  );
  return {
    lastAppliedFileName: String(slot.dataset.lastAppliedFileName || ''),
    hasMedia,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderUploadBucket(container, items, selectedUidSet = new Set(), emptyMessage = '항목이 없습니다.') {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="upload-slot-empty">${emptyMessage}</div>`;
    return;
  }
  container.innerHTML = items.map((item) => `
    <button class="upload-slot-item ${selectedUidSet.has(item.uid) ? 'is-active' : ''}" data-upload-slot-uid="${escapeHtml(item.uid)}">
      <div class="upload-slot-item__title">${escapeHtml(item.label || item.uid)}</div>
      <div class="upload-slot-item__meta">${escapeHtml(item.meta || '슬롯')}</div>
    </button>
  `).join('');
}

function buildUploadAssetLibraryItems(state) {
  const project = state?.project;
  if (!project?.assets?.length) return [];
  const seen = new Set();
  const items = [];
  for (const asset of project.assets) {
    const kind = String(asset.kind || '');
    const preview = String(asset.previewRef || asset.originalRef || '').trim();
    if (!preview) continue;
    if (!/(img|style|source)/i.test(kind)) continue;
    const key = `${asset.originalRef || preview}::${asset.ownerUid || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = asset.ownerLabel || asset.originalRef || preview;
    items.push({
      id: asset.id || key,
      ref: preview,
      thumb: preview,
      label,
      meta: asset.status === 'unresolved' ? '미해결 참조' : (asset.matchedPath || asset.originalRef || kind),
    });
  }
  return items.slice(0, 120);
}

function getOrderedSections(editorMeta = store.getState().editorMeta) {
  return Array.isArray(editorMeta?.sections) ? editorMeta.sections : [];
}

function getSectionPanelSelection(editorMeta = store.getState().editorMeta) {
  const available = new Set(getOrderedSections(editorMeta).map((section) => section.uid));
  let next = sectionPanelSelectionUids.filter((uid) => available.has(uid));
  if (!next.length) {
    const fallback = String(editorMeta?.selectedSectionUid || '').trim();
    if (fallback && available.has(fallback)) next = [fallback];
  }
  sectionPanelSelectionUids = next;
  if (sectionPanelAnchorUid && !available.has(sectionPanelAnchorUid)) sectionPanelAnchorUid = next[0] || '';
  return next;
}

function syncSectionSelectionSummary(editorMeta = store.getState().editorMeta) {
  const selected = getSectionPanelSelection(editorMeta);
  const label = !selected.length ? '선택 없음' : selected.length === 1 ? '1개 선택' : `${selected.length}개 선택`;
  if (elements.sectionSelectionSummary) elements.sectionSelectionSummary.textContent = label;
  const hasSelection = selected.length > 0;
  if (elements.sectionDuplicateButton) elements.sectionDuplicateButton.disabled = !hasSelection;
  if (elements.sectionDeleteButton) elements.sectionDeleteButton.disabled = !hasSelection;
  if (elements.sectionMoveUpButton) elements.sectionMoveUpButton.disabled = !hasSelection;
  if (elements.sectionMoveDownButton) elements.sectionMoveDownButton.disabled = !hasSelection;
}

function setSectionPanelSelection(uids, { anchorUid = '', syncEditor = true, scroll = false, silent = false } = {}) {
  const available = new Set(getOrderedSections().map((section) => section.uid));
  const normalized = Array.from(new Set((Array.isArray(uids) ? uids : [uids]).filter((uid) => available.has(uid))));
  sectionPanelSelectionUids = normalized;
  sectionPanelAnchorUid = anchorUid && available.has(anchorUid) ? anchorUid : (normalized[normalized.length - 1] || '');
  if (syncEditor && normalized.length === 1 && activeEditor) {
    activeEditor.selectNodeByUid(normalized[0], { scroll });
  }
  syncSectionSelectionSummary();
  renderShell(store.getState());
  if (!silent) {
    if (!normalized.length) setStatus('섹션 선택을 해제했습니다.');
    else if (normalized.length === 1) setStatus('섹션을 선택했습니다.');
    else setStatus(`섹션 ${normalized.length}개를 선택했습니다.`);
  }
  return normalized;
}

function toggleSectionPanelSelection(uid, { scroll = false } = {}) {
  const current = new Set(getSectionPanelSelection());
  if (current.has(uid)) current.delete(uid);
  else current.add(uid);
  return setSectionPanelSelection(Array.from(current), { anchorUid: uid, syncEditor: current.size === 1, scroll });
}

function rangeSelectSections(uid, { scroll = true } = {}) {
  const ordered = getOrderedSections();
  if (!ordered.length) return [];
  const anchor = sectionPanelAnchorUid || uid;
  const start = ordered.findIndex((section) => section.uid === anchor);
  const end = ordered.findIndex((section) => section.uid === uid);
  if (start < 0 || end < 0) return setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll });
  const [from, to] = start <= end ? [start, end] : [end, start];
  return setSectionPanelSelection(ordered.slice(from, to + 1).map((section) => section.uid), { anchorUid: anchor, syncEditor: false, scroll, silent: false });
}

function scrollToSectionUid(uid, { behavior = 'smooth', align = 0.12 } = {}) {
  const viewport = elements.previewViewport;
  const doc = elements.previewFrame?.contentDocument;
  if (!viewport || !doc || !uid) return false;
  const target = doc.querySelector(`[data-node-uid="${uid}"]`);
  if (!(target instanceof Element)) return false;
  const docRect = doc.documentElement.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const scale = getCurrentPreviewScale();
  const rawTop = Math.max(0, rect.top - docRect.top);
  const nextTop = Math.max(0, rawTop * scale - viewport.clientHeight * align);
  viewport.scrollTo({ top: nextTop, behavior });
  syncPreviewMinimap();
  return true;
}

function jumpSectionByOffset(direction = 1) {
  const ordered = getOrderedSections();
  if (!ordered.length) return false;
  const selected = getSectionPanelSelection();
  const currentUid = selected[selected.length - 1] || String(store.getState().editorMeta?.selectedSectionUid || '').trim() || ordered[0].uid;
  const index = Math.max(0, ordered.findIndex((section) => section.uid === currentUid));
  const nextIndex = Math.max(0, Math.min(ordered.length - 1, index + direction));
  const nextUid = ordered[nextIndex]?.uid || '';
  if (!nextUid || nextUid === currentUid) return false;
  setSectionPanelSelection([nextUid], { anchorUid: nextUid, syncEditor: true, scroll: true, silent: true });
  scrollToSectionUid(nextUid, { behavior: 'smooth' });
  setStatus(direction > 0 ? '다음 섹션으로 이동했습니다.' : '이전 섹션으로 이동했습니다.');
  return true;
}

function applySectionAction(action, uid, { fromMenu = false } = {}) {
  if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  const selection = getSectionPanelSelection();
  const targetUid = uid || selection[selection.length - 1] || store.getState().editorMeta?.selectedSectionUid || '';
  let result = { ok: false, message: '' };
  if (action === 'select' || action === 'focus') {
    setSectionPanelSelection([targetUid], { anchorUid: targetUid, syncEditor: true, scroll: true, silent: true });
    scrollToSectionUid(targetUid, { behavior: 'smooth' });
    result = { ok: true, message: action === 'focus' ? '현재 섹션 위치로 이동했습니다.' : '섹션을 선택했습니다.' };
  } else if (action === 'toggle-select') {
    toggleSectionPanelSelection(targetUid, { scroll: true });
    result = { ok: true, message: '섹션 선택 상태를 토글했습니다.' };
  } else if (action === 'range-select') {
    rangeSelectSections(targetUid, { scroll: true });
    result = { ok: true, message: '섹션 범위 선택을 적용했습니다.' };
  } else if (action === 'duplicate') {
    const targetList = selection.includes(targetUid) ? selection : [targetUid];
    result = targetList.length > 1 && activeEditor.duplicateSectionsByUidList
      ? activeEditor.duplicateSectionsByUidList(targetList)
      : activeEditor.duplicateSectionByUid(targetUid);
  } else if (action === 'move-up' || action === 'move-down') {
    const targetList = selection.includes(targetUid) ? selection : [targetUid];
    result = targetList.length > 1 && activeEditor.moveSectionsByUidList
      ? activeEditor.moveSectionsByUidList(targetList, action === 'move-up' ? 'up' : 'down')
      : activeEditor.moveSectionByUid(targetUid, action === 'move-up' ? 'up' : 'down');
  } else if (action === 'move-top' || action === 'move-bottom') {
    const ordered = getOrderedSections();
    const destinationUid = action === 'move-top' ? ordered[0]?.uid : ordered[ordered.length - 1]?.uid;
    const position = action === 'move-top' ? 'before' : 'after';
    const targetList = selection.includes(targetUid) ? selection : [targetUid];
    result = targetList.length > 1 && activeEditor.moveSectionsRelativeByUidList
      ? activeEditor.moveSectionsRelativeByUidList(targetList, destinationUid, position)
      : activeEditor.moveSectionRelativeByUid(targetUid, destinationUid, position);
  } else if (action === 'delete') {
    const targetList = selection.includes(targetUid) ? selection : [targetUid];
    result = targetList.length > 1 && activeEditor.deleteSectionsByUidList
      ? activeEditor.deleteSectionsByUidList(targetList)
      : activeEditor.deleteSectionByUid(targetUid);
    if (result?.ok) sectionPanelSelectionUids = [];
  }
  if (fromMenu) document.querySelectorAll('[data-section-menu][open]').forEach((node) => node.removeAttribute('open'));
  if (result?.message) setStatus(result.message);
  return result;
}

function clearSectionDragVisuals() {
  sectionDragState.targetUid = '';
  sectionDragState.position = 'after';
  elements.sectionList?.classList.remove('is-drag-active');
  for (const node of elements.sectionList?.querySelectorAll?.('.is-dragging, .drop-before, .drop-after, .is-drop-target-before, .is-drop-target-after') || []) {
    node.classList.remove('is-dragging', 'drop-before', 'drop-after', 'is-drop-target-before', 'is-drop-target-after');
  }
}

function buildMinimapStructureSignature(editorMeta = store.getState().editorMeta) {
  return getOrderedSections(editorMeta)
    .map((section) => `${section.uid}:${Math.max(1, Number(section.height || 0))}`)
    .join('|');
}

function getViewportFocusedSectionUid(editorMeta = store.getState().editorMeta) {
  const sections = getOrderedSections(editorMeta);
  const viewport = elements.previewViewport;
  if (!viewport || !sections.length) return '';
  const scrollHeight = Math.max(1, viewport.scrollHeight);
  const ratioCenter = Math.max(0, Math.min(1, (viewport.scrollTop + viewport.clientHeight / 2) / scrollHeight));
  const total = Math.max(1, sections.reduce((sum, section) => sum + Math.max(1, Number(section.height || 1)), 0));
  let offset = 0;
  for (const section of sections) {
    const height = Math.max(1, Number(section.height || 1));
    const startRatio = offset / total;
    const endRatio = (offset + height) / total;
    if (ratioCenter >= startRatio && ratioCenter <= endRatio) return section.uid;
    offset += height;
  }
  return sections[sections.length - 1]?.uid || '';
}

function updatePreviewMinimapMarkerState(editorMeta = store.getState().editorMeta) {
  const track = elements.previewMinimapTrack;
  if (!track) return;
  const selected = new Set(getSectionPanelSelection(editorMeta));
  const currentUid = getViewportFocusedSectionUid(editorMeta);
  currentViewportSectionUid = currentUid;
  for (const marker of Array.from(track.querySelectorAll('[data-minimap-section-uid]'))) {
    const uid = marker.getAttribute('data-minimap-section-uid') || '';
    marker.classList.toggle('is-active', selected.has(uid));
    marker.classList.toggle('is-current', uid === currentUid);
  }
}

function schedulePreviewMinimapSync() {
  if (previewMinimapSyncRaf) return;
  previewMinimapSyncRaf = requestAnimationFrame(() => {
    previewMinimapSyncRaf = 0;
    syncPreviewMinimap();
  });
}

function renderPreviewMinimap(editorMeta = store.getState().editorMeta) {
  const minimap = elements.previewMinimap;
  const track = elements.previewMinimapTrack;
  if (!minimap || !track) return;
  const sections = getOrderedSections(editorMeta);
  if (!sections.length) {
    minimap.hidden = true;
    track.innerHTML = '';
    minimapStructureSignature = '';
    return;
  }
  const signature = buildMinimapStructureSignature(editorMeta);
  if (signature !== minimapStructureSignature) {
    const total = Math.max(1, sections.reduce((sum, section) => sum + Math.max(1, Number(section.height || 1)), 0));
    let offset = 0;
    track.innerHTML = sections.map((section) => {
      const top = (offset / total) * 100;
      const height = Math.max(6, (Math.max(1, Number(section.height || 1)) / total) * 100);
      offset += Math.max(1, Number(section.height || 1));
      return `<button class="preview-minimap__marker" data-minimap-section-uid="${escapeHtml(section.uid)}" style="top:${top.toFixed(3)}%;height:${height.toFixed(3)}%" title="${escapeHtml(section.name || section.uid)}"></button>`;
    }).join('');
    minimapStructureSignature = signature;
  }
  minimap.hidden = false;
  updatePreviewMinimapMarkerState(editorMeta);
  schedulePreviewMinimapSync();
}

function syncPreviewMinimap() {
  const minimap = elements.previewMinimap;
  const viewportRect = elements.previewMinimapViewportRect;
  const viewport = elements.previewViewport;
  if (!minimap || !viewportRect || !viewport || minimap.hidden) return;
  const scrollHeight = Math.max(1, viewport.scrollHeight);
  const ratioTop = viewport.scrollTop / scrollHeight;
  const ratioHeight = Math.max(0.08, viewport.clientHeight / scrollHeight);
  viewportRect.style.top = `calc(10px + ${(Math.min(1, ratioTop) * 100).toFixed(3)}% )`;
  viewportRect.style.height = `calc(${(Math.min(1, ratioHeight) * 100).toFixed(3)}% - 2px)`;
  updatePreviewMinimapMarkerState();
}

function renderSectionPreviewFallback(mount, source) {
  const rect = source.getBoundingClientRect();
  const width = Math.max(160, Math.round(rect.width || 160));
  const height = Math.max(120, Math.round(rect.height || 120));
  const scale = Math.min(1, Math.min(168 / width, 112 / height));
  const viewport = document.createElement('div');
  viewport.className = 'section-film-card__viewport';
  const inner = document.createElement('div');
  inner.className = 'section-film-card__viewport-inner';
  inner.style.width = `${width}px`;
  inner.style.height = `${height}px`;
  inner.style.transform = `scale(${scale})`;
  const clone = source.cloneNode(true);
  clone.querySelectorAll('[data-editor-runtime], [data-editor-overlay], [data-resize-corner]').forEach((node) => node.remove());
  clone.querySelectorAll('.__phase5_selected_slot, .__phase5_selected_text, .__phase5_selected_box, .__phase5_selected_multi, .__phase6_drop_hover').forEach((node) => {
    node.classList.remove('__phase5_selected_slot', '__phase5_selected_text', '__phase5_selected_box', '__phase5_selected_multi', '__phase6_drop_hover');
  });
  clone.querySelectorAll('[contenteditable="true"]').forEach((node) => node.setAttribute('contenteditable', 'false'));
  clone.style.pointerEvents = 'none';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.maxWidth = 'none';
  clone.style.width = `${width}px`;
  inner.appendChild(clone);
  viewport.appendChild(inner);
  mount.appendChild(viewport);
}

async function renderSectionPreviewScreenshot(mount, uid, cacheKey, token, renderOptions = null) {
  if (!activeEditor?.exportSectionThumbnailBlob || !uid) return false;
  try {
    const options = renderOptions || getSectionThumbnailRenderOptions(store.getState().editorMeta, uid);
    const blob = await activeEditor.exportSectionThumbnailBlob(uid, { maxWidth: options.maxWidth, maxHeight: options.maxHeight });
    if (!(blob instanceof Blob)) return false;
    if (token !== sectionPreviewRenderToken) return false;
    const existing = sectionPreviewImageCache.get(cacheKey);
    if (existing?.url) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(blob);
    sectionPreviewImageCache.set(cacheKey, { url, at: Date.now() });
    if (!mount.isConnected) return true;
    mount.innerHTML = '';
    mount.classList.add('is-image');
    const image = document.createElement('img');
    image.className = 'section-film-card__preview-image';
    image.loading = 'lazy';
    image.alt = '섹션 썸네일';
    image.src = url;
    mount.appendChild(image);
    return true;
  } catch {
    return false;
  }
}

function cleanupSectionPreviewCache(liveKeys) {
  for (const [key, entry] of Array.from(sectionPreviewImageCache.entries())) {
    if (liveKeys.has(key)) continue;
    if (entry?.url) URL.revokeObjectURL(entry.url);
    sectionPreviewImageCache.delete(key);
  }
}

function hydrateSectionFilmstripPreviews() {
  const list = elements.sectionList;
  const previewDoc = elements.previewFrame?.contentDocument;
  const editorMeta = store.getState().editorMeta;
  if (!list || !previewDoc) return;
  const cards = Array.from(list.querySelectorAll('[data-section-preview-uid]'));
  const modelVersion = Number(editorMeta?.modelVersion || 0);
  const token = ++sectionPreviewRenderToken;
  const liveKeys = new Set();
  const pending = [];
  for (const mount of cards) {
    const uid = mount.getAttribute('data-section-preview-uid') || '';
    const cacheKey = `${uid}:${modelVersion}:${normalizeSectionThumbnailPreset(currentSectionThumbnailPreset)}`;
    liveKeys.add(cacheKey);
    mount.classList.remove('is-image');
    const cached = sectionPreviewImageCache.get(cacheKey);
    if (cached?.url) {
      mount.innerHTML = `<img class="section-film-card__preview-image" loading="lazy" alt="섹션 썸네일" src="${cached.url}" />`;
      mount.classList.add('is-image');
      continue;
    }
    mount.innerHTML = '';
    const source = uid ? previewDoc.querySelector(`[data-node-uid="${uid}"]`) : null;
    if (!source) {
      mount.innerHTML = '<div class="section-film-card__preview-placeholder">미리보기를 찾지 못했습니다.</div>';
      continue;
    }
    renderSectionPreviewFallback(mount, source);
    const renderOptions = getSectionThumbnailRenderOptions(editorMeta, uid);
    if (renderOptions.useScreenshot) pending.push({ mount, uid, cacheKey, renderOptions });
  }
  cleanupSectionPreviewCache(liveKeys);
  if (!pending.length) return;
  void (async () => {
    for (const item of pending) {
      if (token !== sectionPreviewRenderToken) break;
      // eslint-disable-next-line no-await-in-loop
      await renderSectionPreviewScreenshot(item.mount, item.uid, item.cacheKey, token, item.renderOptions);
    }
  })();
}

function renderUploadLists(state) {
  const editorMeta = state?.editorMeta || {};
  renderUploadAssetLibrary(elements.uploadAssetLibrary, buildUploadAssetLibraryItems(state));
  const slots = Array.isArray(editorMeta.slots) ? editorMeta.slots : [];
  const selectedUidSet = new Set((editorMeta.selectedItems || []).map((item) => item.uid));
  const emptySlotUidSet = new Set((editorMeta.preflight?.emptySlots || []).map((slot) => slot.uid));
  const brokenSlotUidSet = new Set((state?.project?.assets || [])
    .filter((asset) => asset.status === 'unresolved' && asset.ownerUid)
    .map((asset) => asset.ownerUid));

  const recent = [];
  const documentUse = [];
  const unassigned = [];
  const broken = [];

  for (const slot of slots) {
    const runtime = getSlotRuntimeMeta(slot.uid);
    const baseItem = {
      uid: slot.uid,
      label: slot.label || slot.uid,
      meta: runtime.lastAppliedFileName || `score ${slot.score ?? '-'}`,
    };
    if (runtime.lastAppliedFileName) recent.push(baseItem);
    if (runtime.hasMedia && !runtime.lastAppliedFileName) documentUse.push(baseItem);
    if (emptySlotUidSet.has(slot.uid)) unassigned.push({ ...baseItem, meta: '빈 슬롯' });
    if (brokenSlotUidSet.has(slot.uid)) broken.push({ ...baseItem, meta: '미해결 자산 연결' });
  }

  renderUploadBucket(elements.uploadRecentList, recent, selectedUidSet, '최근 업로드가 없습니다.');
  renderUploadBucket(elements.uploadDocumentList, documentUse, selectedUidSet, '문서 기본 이미지만 사용 중입니다.');
  renderUploadBucket(elements.uploadUnassignedList, unassigned, selectedUidSet, '미할당 슬롯이 없습니다.');
  renderUploadBucket(elements.uploadBrokenList, broken, selectedUidSet, '깨진 자산 슬롯이 없습니다.');
}

function renderProjectSnapshotList(state) {
  if (!elements.snapshotList) return;
  const entries = getSnapshotEntriesForProject(state?.project || null);
  if (!entries.length) {
    elements.snapshotList.innerHTML = '<div class="upload-slot-empty">저장된 스냅샷이 없습니다.</div>';
    return;
  }
  elements.snapshotList.innerHTML = entries.map((entry) => {
    const createdText = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '-';
    const previewText = escapeHtml(entry.thumbnail?.text || '미리보기 없음');
    const imageSrc = String(entry.thumbnail?.imageSrc || '').trim();
    const thumb = imageSrc
      ? `<img src="${escapeHtml(imageSrc)}" alt="스냅샷 썸네일" loading="lazy" />`
      : `<span>${previewText}</span>`;
    return `
      <article class="snapshot-item" data-snapshot-id="${escapeHtml(entry.id)}">
        <div class="snapshot-item__top">
          <strong class="snapshot-item__title">${escapeHtml(entry.title || '이름 없음')}</strong>
          <span class="snapshot-item__time">${escapeHtml(createdText)}</span>
        </div>
        <div class="snapshot-item__thumb">${thumb}</div>
        <p class="snapshot-item__desc">${escapeHtml(entry.note || previewText)}</p>
        <div class="snapshot-item__actions">
          <button class="button button--small button--secondary" type="button" data-snapshot-action="restore">복원</button>
          <button class="button button--small button--ghost" type="button" data-snapshot-action="delete">삭제</button>
        </div>
      </article>
    `;
  }).join('');
}

function setCodeSource(nextSource, { preserveDraft = true } = {}) {
  currentCodeSource = nextSource || 'edited';
  for (const button of elements.codeSourceButtons) {
    button.classList.toggle('is-active', button.dataset.codeSource === currentCodeSource);
  }
  if (!preserveDraft) codeEditorDirty = false;
  refreshCodeEditorFromState({ force: !preserveDraft });
  syncCodeFlowState();
  syncCodeCompareOptionLabels();
  syncCodeCompareCompactControls();
}

function currentProjectHtmlText(state) {
  const project = state?.project || null;
  if (!project) return '';
  if (currentCodeSource === 'normalized') return project.normalizedHtml || '';
  if (currentCodeSource === 'original') return project.originalHtml || '';
  if (currentCodeSource === 'report') return JSON.stringify(buildReportPayload(project, getEditorReport(project)), null, 2);
  return elements.editedCodeView?.textContent || '';
}

function refreshCodeEditorFromState({ force = false } = {}) {
  if (!elements.codeEditorTextarea) return;
  const textarea = elements.codeEditorTextarea;
  if (codeEditorDirty && !force && document.activeElement === textarea) return;
  const nextValue = currentProjectHtmlText(store.getState());
  textarea.value = nextValue;
  textarea.readOnly = currentCodeSource === 'report';
  codeEditorDirty = false;
  syncCodeFlowState();
  syncCodeWorkbenchState();
}

function syncCodeFlowState() {
  if (!elements.codeFlowState) return;
  const sourceLabel = currentCodeSource === 'normalized' ? '정규화 HTML' : currentCodeSource === 'original' ? '원본 HTML' : currentCodeSource === 'report' ? '리포트 JSON' : '편집 HTML';
  const dirtyText = codeEditorDirty ? ' · 코드 초안 변경됨' : '';
  elements.codeFlowState.textContent = `현재 보기: ${sourceLabel}${dirtyText}`;
}


function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeColor(value) {
  const text = String(value || '').trim();
  return /^#(?:[0-9a-f]{3,8})$/i.test(text)
    || /^rgba?\(/i.test(text)
    || /^hsla?\(/i.test(text)
    || /^(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|navy|teal|transparent)$/i.test(text);
}

function cssColorToRgbTuple(value) {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = String(value || '').trim();
  const resolved = String(probe.style.color || '').trim();
  const match = resolved.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)];
}

function rgbTupleToHex(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 3) return '';
  return `#${tuple.slice(0, 3).map((item) => Math.max(0, Math.min(255, Number(item) || 0)).toString(16).padStart(2, '0')).join('')}`;
}

function normalizeCssColorKey(value) {
  const text = String(value || '').trim();
  const tuple = cssColorToRgbTuple(text);
  if (tuple) return `rgb(${tuple[0]},${tuple[1]},${tuple[2]})`;
  return text.toLowerCase();
}

function toColorInputValue(value) {
  const text = String(value || '').trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return text.length === 4
    ? `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
    : text.toLowerCase();
  const tuple = cssColorToRgbTuple(text);
  if (tuple) return rgbTupleToHex(tuple);
  return '#888888';
}

function getBestEditedHtml(state = store.getState()) {
  const project = state?.project || null;
  if (!project) return '';
  if (activeEditor?.getEditedHtml) {
    try {
      return activeEditor.getEditedHtml({ persistDetectedSlots: true }) || project.normalizedHtml || '';
    } catch {
      return elements.editedCodeView?.textContent || project.normalizedHtml || '';
    }
  }
  return elements.editedCodeView?.textContent || project.normalizedHtml || '';
}

function extractCssColorTokensFromHtml(html) {
  const source = String(html || '');
  const tokens = [];
  const styleBlocks = Array.from(source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const seen = new Set();
  styleBlocks.forEach((match, styleIndex) => {
    const css = match[1] || '';
    for (const tokenMatch of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}{]+)\s*;/g)) {
      const name = tokenMatch[1];
      const value = String(tokenMatch[2] || '').trim();
      if (!looksLikeColor(value)) continue;
      const key = `${styleIndex}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ key, name, value, styleIndex });
    }
  });
  return tokens;
}

function looksLikeLengthTokenValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return text.split(/\s+/).every((part) => /^-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)$/.test(part));
}

function looksLikeShadowTokenValue(value) {
  const text = String(value || '').trim();
  return ((/(rgba?\(|hsla?\(|#)/i.test(text) && /\d(?:px|rem|em)/i.test(text)) || /\binset\b/i.test(text));
}

function classifyDesignToken(name, value) {
  const lowerName = String(name || '').toLowerCase();
  const text = String(value || '').trim();
  if (!lowerName || !text) return '';
  if (looksLikeColor(text)) return 'color';
  if (/shadow|elevation/.test(lowerName) || looksLikeShadowTokenValue(text)) return 'shadow';
  if (/radius|round|corner/.test(lowerName)) return 'radius';
  if (/font|type|letter|line|leading|tracking|weight/.test(lowerName) || /(?:,\s*(sans-serif|serif|monospace)|'|")/.test(text) || /^-?\d*\.?\d+$/.test(text)) return 'typography';
  if (/space|spacing|gap|gutter|pad|padding|margin|inset|offset/.test(lowerName) || looksLikeLengthTokenValue(text)) return 'spacing';
  return '';
}

function getDesignTokenCategoryLabel(category) {
  if (category === 'typography') return 'Typography';
  if (category === 'spacing') return 'Spacing';
  if (category === 'radius') return 'Radius';
  if (category === 'shadow') return 'Shadow';
  return 'Token';
}

function extractCssDesignTokensFromHtml(html) {
  const source = String(html || '');
  const tokens = [];
  const styleBlocks = Array.from(source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const seen = new Set();
  styleBlocks.forEach((match, styleIndex) => {
    const css = match[1] || '';
    for (const tokenMatch of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}{]+)\s*;/g)) {
      const name = tokenMatch[1];
      const value = String(tokenMatch[2] || '').trim();
      const category = classifyDesignToken(name, value);
      if (!category || category === 'color') continue;
      const key = `${styleIndex}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ key, name, value, styleIndex, category });
    }
  });
  return tokens;
}

function buildSuggestedCssVarName(value, index = 1) {
  const key = normalizeCssColorKey(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  const colorHex = toColorInputValue(value).replace('#', '') || `color-${index}`;
  const base = slugify(key || colorHex || `inline-color-${index}`) || `inline-color-${index}`;
  return `--${base.startsWith('inline-') ? base : `inline-${base}`}`;
}

function extractRepeatedInlineColorCandidatesFromHtml(html) {
  const doc = parseHtmlToDocument(html);
  const groups = new Map();
  Array.from(doc.querySelectorAll('[style]')).forEach((element) => {
    const styleValue = String(element.getAttribute('style') || '');
    const sanitizedStyle = styleValue.replace(/var\([^)]*\)/gi, '');
    extractColorMatchesFromText(sanitizedStyle).forEach((match) => {
      const key = match.key;
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, displayValue: match.raw, swatchValue: toColorInputValue(match.raw), occurrences: 0, variants: new Set(), owners: new Set() });
      const item = groups.get(key);
      item.occurrences += 1;
      item.variants.add(match.raw);
      item.owners.add((element.tagName || '').toLowerCase());
    });
  });
  let index = 0;
  return Array.from(groups.values())
    .filter((item) => item.occurrences >= 2)
    .sort((a, b) => b.occurrences - a.occurrences || a.displayValue.localeCompare(b.displayValue))
    .map((item) => ({ ...item, owners: Array.from(item.owners), variants: Array.from(item.variants), suggestedName: buildSuggestedCssVarName(item.displayValue, ++index) }));
}

function ensureGeneratedStyleBlock(doc, attributeName) {
  const selector = `style[${attributeName}]`;
  let styleEl = doc.head?.querySelector(selector);
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.setAttribute(attributeName, '1');
    if (doc.head) doc.head.appendChild(styleEl);
    else doc.documentElement.appendChild(styleEl);
  }
  return styleEl;
}

function upsertCssVariablesIntoStyle(styleEl, variableEntries) {
  const entries = variableEntries.filter((entry) => entry && entry.name && entry.value);
  if (!entries.length) return;
  const css = String(styleEl.textContent || '');
  const varLines = entries.map((entry) => `  ${entry.name}: ${entry.value};`).join('\n');
  if (/:root\s*\{[\s\S]*?\}/m.test(css)) {
    styleEl.textContent = css.replace(/:root\s*\{([\s\S]*?)\}/m, (full, body) => {
      let nextBody = String(body || '');
      entries.forEach((entry) => {
        const pattern = new RegExp(`(^|\\n)\\s*${escapeRegExp(entry.name)}\\s*:\\s*[^;]+;?`, 'm');
        if (pattern.test(nextBody)) nextBody = nextBody.replace(pattern, `$1  ${entry.name}: ${entry.value};`);
        else nextBody = `${nextBody.trimEnd()}\n  ${entry.name}: ${entry.value};`;
      });
      return `:root {\n${nextBody.trim()}\n}`;
    });
  } else {
    styleEl.textContent = `${css.trim()}\n:root {\n${varLines}\n}\n`.trim();
  }
}

function extractSectionThemePalettesFromHtml(html, state = store.getState()) {
  const sections = Array.isArray(state?.editorMeta?.sections) ? state.editorMeta.sections : [];
  return sections.map((section) => {
    const palette = extractStyleColorGroupsFromHtml(html, { scope: 'selected-section', sectionUid: section.uid }).slice(0, 8);
    return { uid: section.uid, name: section.name, index: section.index, note: section.note || '', colors: palette, slotCount: section.slotCount || 0, textCount: section.textCount || 0 };
  });
}

function relativeLuminance(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 3) return 0;
  const transform = (channel) => {
    const c = (Number(channel) || 0) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = tuple;
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function getContrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getEffectiveBackgroundRgb(win, element) {
  let current = element;
  while (current && current.nodeType === 1) {
    const bg = String(win.getComputedStyle(current).backgroundColor || '').trim();
    const transparent = /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*0\s*)?\)$/i.test(bg) || /transparent/i.test(bg);
    const tuple = cssColorToRgbTuple(bg);
    if (tuple && !transparent) return tuple;
    current = current.parentElement;
  }
  const bodyTuple = cssColorToRgbTuple(win.getComputedStyle(win.document.body || win.document.documentElement).backgroundColor || '#ffffff');
  return bodyTuple || [255, 255, 255];
}

function buildContrastLintIssuesFromPreview(state = store.getState()) {
  const frameDoc = elements.previewFrame?.contentDocument;
  const frameWin = elements.previewFrame?.contentWindow;
  if (!frameDoc || !frameWin) return [];
  const source = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || currentProjectHtmlText(state) || '';
  const issues = [];
  const nodes = Array.from(frameDoc.body?.querySelectorAll('p, span, a, li, button, h1, h2, h3, h4, h5, h6, small, strong, em, div') || []);
  for (const element of nodes) {
    if (issues.length >= 120) break;
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    const style = frameWin.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) continue;
    const color = cssColorToRgbTuple(style.color || '');
    const bg = getEffectiveBackgroundRgb(frameWin, element);
    if (!color || !bg) continue;
    const ratio = getContrastRatio(color, bg);
    const fontSize = Number.parseFloat(style.fontSize || '0');
    const fontWeight = Number.parseFloat(style.fontWeight || '400');
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const threshold = isLarge ? 3 : 4.5;
    if (ratio >= threshold) continue;
    const uid = element.closest('[data-node-uid]')?.getAttribute('data-node-uid') || element.getAttribute('data-node-uid') || '';
    const position = uid ? findPatternPosition(source, new RegExp(`data-node-uid=["']${escapeRegExp(uid)}["']`, 'i')) : { line: 1, column: 1 };
    issues.push({
      level: ratio < 3 ? 'error' : 'warning',
      title: '낮은 색상 대비',
      message: `${text.slice(0, 40)}${text.length > 40 ? '…' : ''} · 대비 ${ratio.toFixed(2)}:1 · 기준 ${threshold}:1`,
      ratio: Number(ratio.toFixed(2)),
      uid,
      line: position.line,
      column: position.column,
    });
  }
  return issues.sort((a, b) => a.ratio - b.ratio);
}

function chunkLooksColorRelated(chunk) {
  if (!chunk) return false;
  const source = `${(chunk.removedLines || []).join('\n')}\n${(chunk.addedLines || []).join('\n')}`;
  if (!source.trim()) return false;
  STYLE_COLOR_VALUE_REGEX.lastIndex = 0;
  if (STYLE_COLOR_VALUE_REGEX.test(source)) return true;
  return /--[A-Za-z0-9_-]+|\b(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|box-shadow|text-shadow)\b/i.test(source);
}

function renderDesignTokenEditor(state = store.getState()) {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || currentProjectHtmlText(state);
  const tokens = extractCssDesignTokensFromHtml(html);
  lastDesignTokenPalette = tokens;
  if (!elements.designTokenList || !elements.designTokenSummary) return tokens;
  if (!tokens.length) {
    elements.designTokenSummary.textContent = '감지된 typography / spacing / radius / shadow 토큰이 없습니다.';
    elements.designTokenList.innerHTML = '<div class="asset-empty">스타일 블록의 디자인 토큰을 찾지 못했습니다.</div>';
    return tokens;
  }
  const counts = tokens.reduce((acc, token) => { acc[token.category] = (acc[token.category] || 0) + 1; return acc; }, {});
  elements.designTokenSummary.textContent = `토큰 ${tokens.length}개 · type ${counts.typography || 0} / space ${counts.spacing || 0} / radius ${counts.radius || 0} / shadow ${counts.shadow || 0}`;
  elements.designTokenList.innerHTML = tokens.map((token) => `
    <label class="css-token-item" data-design-token-key="${escapeHtml(token.key)}">
      <span class="css-token-item__meta"><strong>${escapeHtml(token.name)}</strong><small><span class="token-category-badge">${escapeHtml(getDesignTokenCategoryLabel(token.category))}</span> · ${escapeHtml(token.value)}</small></span>
      <span class="css-token-item__inputs css-token-item__inputs--single">
        <input class="css-token-item__text" data-design-token-text="${escapeHtml(token.name)}" type="text" value="${escapeHtml(token.value)}" />
      </span>
    </label>
  `).join('');
  return tokens;
}

function renderInlineColorExtractPanel(state = store.getState()) {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || currentProjectHtmlText(state);
  const candidates = extractRepeatedInlineColorCandidatesFromHtml(html);
  lastInlineColorExtractCandidates = candidates;
  if (!elements.inlineColorExtractList || !elements.inlineColorExtractSummary) return candidates;
  if (!candidates.length) {
    elements.inlineColorExtractSummary.textContent = '반복 inline 색상이 없습니다. 이미 CSS 변수로 잘 정리되어 있거나 반복 횟수가 적습니다.';
    elements.inlineColorExtractList.innerHTML = '<div class="asset-empty">추출할 반복 inline 색상이 없습니다.</div>';
    return candidates;
  }
  elements.inlineColorExtractSummary.textContent = `반복 inline 색상 ${candidates.length}개 · CSS 변수로 정리할 수 있습니다.`;
  elements.inlineColorExtractList.innerHTML = candidates.map((item) => `
    <label class="css-token-item" data-inline-color-key="${escapeHtml(item.key)}">
      <span class="css-token-item__meta"><strong>${escapeHtml(item.displayValue)}</strong><small>${item.occurrences}회 · ${escapeHtml(item.owners.slice(0, 3).join(', ') || 'inline')}</small></span>
      <span class="css-token-item__inputs">
        <input class="css-token-item__color" type="color" value="${escapeHtml(item.swatchValue)}" disabled />
        <input class="css-token-item__text" data-inline-color-token-name="${escapeHtml(item.key)}" type="text" value="${escapeHtml(item.suggestedName)}" />
      </span>
    </label>
  `).join('');
  return candidates;
}

function renderSectionThemePalettes(state = store.getState()) {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || currentProjectHtmlText(state);
  const palettes = extractSectionThemePalettesFromHtml(html, state);
  lastSectionThemePalettes = palettes;
  const selectedUid = getSelectedSectionUidForColorScope(state);
  if (!elements.sectionThemePaletteList || !elements.sectionThemePaletteSummary) return palettes;
  if (!palettes.length) {
    elements.sectionThemePaletteSummary.textContent = '섹션을 불러오면 테마 팔레트를 분석할 수 있습니다.';
    elements.sectionThemePaletteList.innerHTML = '<div class="asset-empty">섹션 팔레트를 표시할 문서가 없습니다.</div>';
    return palettes;
  }
  const selected = palettes.find((item) => item.uid === selectedUid) || null;
  elements.sectionThemePaletteSummary.textContent = selected ? `선택 섹션 팔레트 ${selected.colors.length}개를 편집할 수 있습니다.` : `섹션 ${palettes.length}개 팔레트를 요약했습니다. 섹션 하나를 선택하면 편집 필드가 열립니다.`;
  elements.sectionThemePaletteList.innerHTML = palettes.map((section) => {
    const isSelected = section.uid === selectedUid;
    const swatches = section.colors.slice(0, 6).map((item) => `<span class="section-theme-swatch" title="${escapeHtml(item.displayValue)}" style="background:${escapeHtml(item.displayValue)}"></span>`).join('');
    const editableRows = isSelected ? section.colors.slice(0, 8).map((item) => `
      <label class="css-token-item section-theme-edit-row" data-section-theme-key="${escapeHtml(`${section.uid}::${item.key}`)}">
        <span class="css-token-item__meta"><strong>${escapeHtml(item.displayValue)}</strong><small>${item.occurrences}회</small></span>
        <span class="css-token-item__inputs">
          <input class="css-token-item__color" data-section-theme-input="${escapeHtml(`${section.uid}::${item.key}`)}" type="color" value="${escapeHtml(item.swatchValue)}" />
          <input class="css-token-item__text" data-section-theme-text="${escapeHtml(`${section.uid}::${item.key}`)}" type="text" value="${escapeHtml(item.displayValue)}" />
        </span>
      </label>
    `).join('') : '';
    return `
      <article class="section-theme-card ${isSelected ? 'is-selected' : ''}" data-section-theme-uid="${escapeHtml(section.uid)}">
        <div class="section-theme-card__top">
          <div><strong>${escapeHtml(section.name || `섹션 ${section.index + 1}`)}</strong><small>${section.colors.length}색 · 슬롯 ${section.slotCount}</small></div>
          <button class="button button--ghost button--small" data-section-theme-focus="${escapeHtml(section.uid)}" type="button">선택</button>
        </div>
        <div class="section-theme-swatches">${swatches || '<span class="mini-summary">색상 없음</span>'}</div>
        ${editableRows ? `<div class="section-theme-card__editor">${editableRows}</div>` : ''}
      </article>
    `;
  }).join('');
  return palettes;
}

function renderContrastLintPanel(state = store.getState()) {
  const cacheKey = `${state?.project?.id || 'none'}:${state?.editorMeta?.modelVersion || 0}`;
  const issues = cacheKey === lastContrastLintCacheKey ? lastContrastLintIssues : buildContrastLintIssuesFromPreview(state);
  lastContrastLintIssues = issues;
  lastContrastLintCacheKey = cacheKey;
  if (!elements.contrastLintList || !elements.contrastLintSummary) return issues;
  if (!issues.length) {
    elements.contrastLintSummary.textContent = '현재 미리보기 기준으로 큰 대비 문제는 보이지 않습니다.';
    elements.contrastLintList.innerHTML = '<div class="asset-empty">대비/가독성 문제를 찾지 못했습니다.</div>';
    return issues;
  }
  elements.contrastLintSummary.textContent = `대비/가독성 이슈 ${issues.length}개 · 가장 낮은 대비 ${issues[0].ratio.toFixed(2)}:1`;
  elements.contrastLintList.innerHTML = issues.map((issue) => `
    <article class="code-validation-item" data-level="${escapeHtml(issue.level)}">
      <div class="code-validation-item__top"><span class="code-validation-item__level">${escapeHtml(issue.level === 'error' ? '오류' : '주의')}</span><span class="mini-summary">${escapeHtml(`${issue.ratio.toFixed(2)}:1`)}</span></div>
      <div class="code-validation-item__title">${escapeHtml(issue.title)}</div>
      <div class="code-validation-item__desc">${escapeHtml(issue.message)}</div>
      <div class="button-row button-row--compact">${issue.uid ? `<button class="button button--ghost button--small" data-focus-node-uid="${escapeHtml(issue.uid)}" type="button">요소 선택</button>` : ''}${issue.line ? `<button class="button button--ghost button--small" data-code-jump-line="${Number(issue.line || 1)}" data-code-jump-column="${Number(issue.column || 1)}" type="button">해당 줄</button>` : ''}</div>
    </article>
  `).join('');
  return issues;
}


const STYLE_COLOR_VALUE_REGEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|navy|teal|transparent)\b/gi;

function extractColorMatchesFromText(source) {
  const text = String(source || '');
  const matches = [];
  for (const match of text.matchAll(STYLE_COLOR_VALUE_REGEX)) {
    const raw = String(match[0] || '').trim();
    if (!looksLikeColor(raw)) continue;
    matches.push({ raw, key: normalizeCssColorKey(raw), index: Number(match.index || 0) });
  }
  return matches;
}

function getSelectedSectionUidForColorScope(state = store.getState()) {
  const selectedUids = getSectionPanelSelection(state.editorMeta);
  return selectedUids[0] || state.editorMeta?.selectedSectionUid || '';
}

function findSectionNodeByUid(doc, uid) {
  const target = String(uid || '').trim();
  if (!target) return null;
  return Array.from(doc.querySelectorAll('[data-node-uid]')).find((element) => String(element.getAttribute('data-node-uid') || '').trim() === target) || null;
}

function extractStyleColorGroupsFromHtml(html, options = {}) {
  const scope = options.scope === 'selected-section' ? 'selected-section' : 'document';
  const sectionUid = String(options.sectionUid || '').trim();
  const doc = parseHtmlToDocument(html);
  const sectionRoot = scope === 'selected-section' ? findSectionNodeByUid(doc, sectionUid) : null;
  if (scope === 'selected-section' && !sectionRoot) return [];
  const groups = new Map();
  const addMatch = (raw, sourceType) => {
    const key = normalizeCssColorKey(raw);
    if (!key) return;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        displayValue: String(raw || '').trim(),
        swatchValue: toColorInputValue(raw),
        occurrences: 0,
        styleCount: 0,
        inlineCount: 0,
        variants: new Set(),
      });
    }
    const item = groups.get(key);
    item.occurrences += 1;
    item.variants.add(String(raw || '').trim());
    if (sourceType === 'style') item.styleCount += 1;
    else item.inlineCount += 1;
    const currentDisplay = String(item.displayValue || '');
    const candidate = String(raw || '').trim();
    if (!currentDisplay || candidate.length < currentDisplay.length) item.displayValue = candidate;
    item.swatchValue = toColorInputValue(candidate);
  };
  if (scope === 'selected-section' && sectionRoot) {
    const inlineTargets = [sectionRoot, ...Array.from(sectionRoot.querySelectorAll('[style]'))];
    inlineTargets.forEach((element) => {
      const styleValue = element.getAttribute('style') || '';
      extractColorMatchesFromText(styleValue).forEach((match) => addMatch(match.raw, 'inline'));
    });
    Array.from(sectionRoot.querySelectorAll('style')).forEach((styleEl) => {
      extractColorMatchesFromText(styleEl.textContent || '').forEach((match) => addMatch(match.raw, 'style'));
    });
  } else {
    Array.from(doc.querySelectorAll('style')).forEach((styleEl) => {
      extractColorMatchesFromText(styleEl.textContent || '').forEach((match) => addMatch(match.raw, 'style'));
    });
    Array.from(doc.querySelectorAll('[style]')).forEach((element) => {
      extractColorMatchesFromText(element.getAttribute('style') || '').forEach((match) => addMatch(match.raw, 'inline'));
    });
  }
  return Array.from(groups.values()).map((item) => ({ ...item, variants: Array.from(item.variants) })).sort((a, b) => b.occurrences - a.occurrences || a.displayValue.localeCompare(b.displayValue));
}

function replaceColorVariantsInText(source, variants = [], nextValue = '') {
  let output = String(source || '');
  const targetValue = String(nextValue || '').trim();
  if (!targetValue) return output;
  const sorted = Array.from(new Set((variants || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => b.length - a.length);
  sorted.forEach((variant) => {
    output = output.replace(new RegExp(escapeRegExp(variant), 'gi'), targetValue);
  });
  return output;
}

function applyStyleColorGroupsToHtml(html, replacements = [], options = {}) {
  const scope = options.scope === 'selected-section' ? 'selected-section' : 'document';
  const sectionUid = String(options.sectionUid || '').trim();
  const palette = Array.isArray(options.palette) ? options.palette : [];
  const paletteMap = new Map(palette.map((item) => [item.key, item]));
  const doc = parseHtmlToDocument(html);
  const sectionRoot = scope === 'selected-section' ? findSectionNodeByUid(doc, sectionUid) : null;
  let changeCount = 0;
  const applyToText = (text, item) => {
    const nextText = replaceColorVariantsInText(text, item?.variants || [], item?.nextValue || '');
    if (nextText !== text) changeCount += 1;
    return nextText;
  };
  const activeItems = replacements.map((entry) => ({ ...paletteMap.get(entry.key), nextValue: String(entry.value || '').trim(), key: entry.key })).filter((item) => item && item.nextValue && item.variants?.length);
  if (!activeItems.length) return { html: String(html || ''), changeCount: 0 };
  const styleTargets = scope === 'selected-section' && sectionRoot
    ? Array.from(sectionRoot.querySelectorAll('style'))
    : Array.from(doc.querySelectorAll('style'));
  styleTargets.forEach((styleEl) => {
    let css = String(styleEl.textContent || '');
    activeItems.forEach((item) => { css = applyToText(css, item); });
    styleEl.textContent = css;
  });
  const inlineTargets = scope === 'selected-section' && sectionRoot
    ? [sectionRoot, ...Array.from(sectionRoot.querySelectorAll('[style]'))]
    : Array.from(doc.querySelectorAll('[style]'));
  inlineTargets.forEach((element) => {
    const styleValue = String(element.getAttribute('style') || '');
    let nextStyle = styleValue;
    activeItems.forEach((item) => { nextStyle = applyToText(nextStyle, item); });
    if (nextStyle !== styleValue) element.setAttribute('style', nextStyle);
  });
  return { html: serializeDocument(doc), changeCount };
}

function renderStyleColorStudio(state = store.getState()) {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || currentProjectHtmlText(state);
  const scope = elements.styleColorScopeSelect?.value === 'selected-section' ? 'selected-section' : 'document';
  const sectionUid = getSelectedSectionUidForColorScope(state);
  const palette = extractStyleColorGroupsFromHtml(html, { scope, sectionUid });
  lastStyleColorPalette = palette;
  if (!elements.styleColorList || !elements.styleColorSummary) return palette;
  if (scope === 'selected-section' && !sectionUid) {
    elements.styleColorSummary.textContent = '선택 섹션 범위를 쓰려면 먼저 섹션 하나를 선택해 주세요. 현재는 목록을 표시하지 않습니다.';
    elements.styleColorList.innerHTML = '<div class="asset-empty">먼저 섹션 하나를 선택하면 해당 범위의 inline/style 색상을 모아 보여드립니다.</div>';
    return palette;
  }
  if (!palette.length) {
    elements.styleColorSummary.textContent = scope === 'selected-section'
      ? '선택 섹션 범위에서 직접 수정할 스타일 색상을 찾지 못했습니다.'
      : '문서에서 직접 수정할 스타일 색상을 찾지 못했습니다.';
    elements.styleColorList.innerHTML = '<div class="asset-empty">감지된 스타일 색상이 없습니다.</div>';
    return palette;
  }
  const scopeLabel = scope === 'selected-section' ? '선택 섹션 범위' : '문서 전체';
  const totalOccurrences = palette.reduce((sum, item) => sum + item.occurrences, 0);
  elements.styleColorSummary.textContent = `${scopeLabel}에서 색상 ${palette.length}개 · 총 ${totalOccurrences}회 감지했습니다.`;
  elements.styleColorList.innerHTML = palette.map((item) => `
    <label class="style-color-item" data-style-color-key="${escapeHtml(item.key)}" data-style-color-scope="${escapeHtml(scope)}">
      <span class="style-color-item__top">
        <span class="style-color-item__swatch" style="background:${escapeHtml(item.displayValue)}"></span>
        <span class="style-color-item__meta"><strong>${escapeHtml(item.displayValue)}</strong><small>총 ${item.occurrences}회 · style ${item.styleCount} / inline ${item.inlineCount} · variant ${item.variants.length}개</small></span>
      </span>
      <span class="style-color-item__inputs">
        <input class="style-color-item__color" data-style-color-input="${escapeHtml(item.key)}" type="color" value="${escapeHtml(item.swatchValue)}" />
        <input class="style-color-item__text" data-style-color-text="${escapeHtml(item.key)}" type="text" value="${escapeHtml(item.displayValue)}" />
        <button class="button button--ghost button--small style-color-item__reset" data-style-color-reset="${escapeHtml(item.key)}" type="button">원래값</button>
      </span>
    </label>
  `).join('');
  return palette;
}

function parseHtmlToDocument(html) {
  return new DOMParser().parseFromString(String(html || ''), 'text/html');
}

function serializeDocument(doc) {
  return `<!DOCTYPE html>
${doc.documentElement.outerHTML}`;
}

function isTextMergeCandidate(element) {
  if (!element) return false;
  const tag = String(element.tagName || '').toLowerCase();
  return ['p','span','strong','em','b','i','small','li','h1','h2','h3','h4','h5','h6','a','button'].includes(tag);
}

function safeMergeHtmlDraft(currentHtml, draftHtml) {
  const currentDoc = parseHtmlToDocument(currentHtml);
  const draftDoc = parseHtmlToDocument(draftHtml);
  const currentSections = currentDoc.querySelectorAll('[data-node-uid]').length;
  const draftSections = draftDoc.querySelectorAll('[data-node-uid]').length;
  const currentByUid = new Map(Array.from(currentDoc.querySelectorAll('[data-node-uid]')).map((el) => [el.getAttribute('data-node-uid'), el]));
  const draftByUid = new Map(Array.from(draftDoc.querySelectorAll('[data-node-uid]')).map((el) => [el.getAttribute('data-node-uid'), el]));
  const shared = Array.from(currentByUid.keys()).filter((uid) => draftByUid.has(uid));
  if (!shared.length || shared.length / Math.max(1, currentByUid.size, draftByUid.size) < 0.55) {
    return { ok: false, reason: 'uid-overlap-low', message: '공유 UID가 적어서 안전 적용 대신 전체 적용이 필요합니다.' };
  }
  const currentStyles = Array.from(currentDoc.querySelectorAll('style'));
  const draftStyles = Array.from(draftDoc.querySelectorAll('style'));
  const styleCount = Math.min(currentStyles.length, draftStyles.length);
  for (let i = 0; i < styleCount; i += 1) currentStyles[i].textContent = draftStyles[i].textContent;
  if (draftStyles.length > currentStyles.length) {
    const head = currentDoc.head || currentDoc.documentElement;
    draftStyles.slice(currentStyles.length).forEach((styleEl) => head.appendChild(styleEl.cloneNode(true)));
  }
  let mergedTextNodes = 0;
  let mergedAttributeGroups = 0;
  for (const uid of shared) {
    const currentEl = currentByUid.get(uid);
    const draftEl = draftByUid.get(uid);
    if (!currentEl || !draftEl || currentEl.tagName !== draftEl.tagName) continue;
    const isImageish = draftEl.matches?.('img, [data-image-slot], [data-detected-slot], .image-slot, .drop-slot')
      || currentEl.matches?.('img, [data-image-slot], [data-detected-slot], .image-slot, .drop-slot');
    const attrsToMerge = isImageish
      ? ['data-slot-label','data-slot-schema','data-image-slot','data-section-note','title','aria-label']
      : ['data-slot-label','data-slot-schema','data-image-slot','data-section-note','data-builder-section','class','style','title','aria-label'];
    attrsToMerge.forEach((attr) => {
      if (draftEl.hasAttribute(attr)) currentEl.setAttribute(attr, draftEl.getAttribute(attr) || '');
      else if (attr.startsWith('data-') && currentEl.hasAttribute(attr)) currentEl.removeAttribute(attr);
    });
    mergedAttributeGroups += 1;
    if (!isImageish && isTextMergeCandidate(draftEl) && !draftEl.querySelector('img, video, iframe, canvas')) {
      currentEl.innerHTML = draftEl.innerHTML;
      mergedTextNodes += 1;
    }
  }
  const mergedHtml = serializeDocument(currentDoc);
  return {
    ok: true,
    html: mergedHtml,
    summary: {
      currentNodes: currentByUid.size,
      draftNodes: draftByUid.size,
      sharedNodes: shared.length,
      mergedTextNodes,
      mergedAttributeGroups,
      structureDelta: draftSections - currentSections,
    },
  };
}

function buildUnresolvedAssetItems(project = null) {
  const assets = Array.from(project?.assets || []);
  const seen = new Map();
  for (const asset of assets) {
    if (asset.status !== 'unresolved') continue;
    const key = String(asset.originalRef || '').trim();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { ref: key, owners: [] });
    seen.get(key).owners.push(asset.ownerLabel || asset.ownerUid || asset.attribute || 'asset');
  }
  return Array.from(seen.values());
}

function filenameKey(value) {
  const raw = String(value || '').trim();
  const base = raw.replace(/^uploaded:/i, '').split(/[?#]/)[0].split('/').pop() || raw;
  return base.toLowerCase();
}

function buildMarketUploadLint(html, project = null, editorMeta = null) {
  const source = String(html || '');
  const issues = [];
  const add = (level, title, message, pattern = null) => {
    const position = pattern ? findPatternPosition(source, pattern) : { line: 1, column: 1, index: 0 };
    issues.push({ level, title, message, line: position.line, column: position.column, pattern: pattern ? String(pattern) : '' });
  };
  if (/<script/i.test(source)) add('error', 'script 태그 포함', '일반 마켓 업로드용 상세 HTML에서는 script 사용을 피하는 편이 안전합니다.', /<script/i);
  if (/<iframe/i.test(source)) add('error', 'iframe 태그 포함', 'iframe은 마켓 업로드/앱 내 상세보기에서 차단될 수 있습니다.', /<iframe/i);
  if (/<(?:video|audio|canvas|form|input|select|textarea)/i.test(source)) add('warning', '인터랙티브 태그 포함', 'video/form/input/select 같은 태그는 일부 채널에서 기대한 대로 동작하지 않을 수 있습니다.', /<(?:video|audio|canvas|form|input|select|textarea)/i);
  if (/position\s*:\s*(fixed|sticky)/i.test(source)) add('warning', '고정/스티키 포지션 포함', 'position:fixed/sticky는 상세페이지 환경에서 깨질 수 있습니다.', /position\s*:\s*(fixed|sticky)/i);
  if (/@import\s+url\(['"]?https?:/i.test(source) || /<link[^>]+href=["']https?:/i.test(source)) add('warning', '원격 stylesheet/font 사용', '원격 CSS/폰트는 일부 환경에서 차단되거나 로딩 지연이 발생할 수 있습니다.', /(?:@import\s+url\(|<link[^>]+href=["']https?:)/i);
  if (/https?:\/\//i.test(source)) add('info', '원격 리소스 포함', '원격 이미지/폰트/링크가 포함되어 있으면 판매 채널 정책에 따라 동작이 달라질 수 있습니다.', /https?:\/\//i);
  if (/\[이미지 삽입부\]/.test(source)) add('warning', '플레이스홀더 잔존', '[이미지 삽입부]가 아직 남아 있습니다.', /\[이미지 삽입부\]/);
  if ((editorMeta?.preflight?.blockingErrors || 0) > 0) add('warning', '출력 전 검수 오류', `현재 출력 전 검수 오류가 ${editorMeta.preflight.blockingErrors}개 있습니다.`, null);
  const unresolvedCount = buildUnresolvedAssetItems(project).length;
  if (unresolvedCount) add('error', '미해결 자산 경로', `아직 다시 연결되지 않은 자산이 ${unresolvedCount}개 있습니다.`, null);
  if (/data:image\//i.test(source) && source.length > 1200000) add('info', '대용량 인라인 이미지', 'data:image가 많으면 저장 HTML이 매우 커질 수 있습니다. 마켓 업로드용은 linked/압축 저장도 함께 고려해 주세요.', /data:image\//i);
  return issues;
}

function renderLintIssues(container, issues = []) {
  if (container === elements.marketLintList) lastMarketLintIssues = Array.isArray(issues) ? issues : [];
  if (!container) return;
  if (!issues.length) {
    container.innerHTML = '<div class="asset-empty">현재 감지된 마켓 업로드 lint 이슈가 없습니다.</div>';
    return;
  }
  container.innerHTML = issues.map((issue) => `
    <article class="code-validation-item" data-level="${escapeHtml(issue.level)}">
      <div class="code-validation-item__top">
        <span class="code-validation-item__level">${escapeHtml(issue.level === 'error' ? '오류' : issue.level === 'warning' ? '주의' : '안내')}</span>
        <span class="mini-summary">${escapeHtml(issue.line ? `${issue.line}줄` : '위치 없음')}</span>
      </div>
      <div class="code-validation-item__title">${escapeHtml(issue.title)}</div>
      <div class="code-validation-item__desc">${escapeHtml(issue.message)}</div>
      ${issue.line ? `<div class="button-row button-row--compact"><button class="button button--ghost button--small" data-code-jump-line="${Number(issue.line || 1)}" data-code-jump-column="${Number(issue.column || 1)}" type="button">해당 줄 보기</button></div>` : ''}
    </article>
  `).join('');
}

function renderBrokenAssetPanel(project = null) {
  const items = buildUnresolvedAssetItems(project);
  if (elements.brokenAssetList) {
    if (!items.length) elements.brokenAssetList.innerHTML = '<div class="asset-empty">미해결 자산이 없습니다.</div>';
    else elements.brokenAssetList.innerHTML = items.slice(0, 12).map((item) => `<div class="asset-ref-item"><strong>${escapeHtml(item.ref)}</strong><small>${escapeHtml(item.owners.slice(0, 3).join(', '))}</small></div>`).join('');
  }
  if (elements.brokenAssetRelinkSummary) {
    elements.brokenAssetRelinkSummary.textContent = items.length ? `미해결 자산 ${items.length}개 · 파일명 기준으로 한 번에 다시 연결할 수 있습니다.` : '미해결 자산이 없습니다.';
  }
  return items;
}

function renderCssTokenEditor(state = store.getState()) {
  const html = getBestEditedHtml(state) || currentProjectHtmlText(state);
  const tokens = extractCssColorTokensFromHtml(html);
  lastCssTokenPalette = tokens;
  if (!elements.cssTokenList) return tokens;
  if (!tokens.length) {
    elements.cssTokenList.innerHTML = '<div class="asset-empty">감지된 컬러 토큰이 없습니다.</div>';
    return tokens;
  }
  elements.cssTokenList.innerHTML = tokens.map((token) => `
    <label class="css-token-item" data-token-name="${escapeHtml(token.name)}">
      <span class="css-token-item__meta"><strong>${escapeHtml(token.name)}</strong><small>${escapeHtml(token.value)}</small></span>
      <span class="css-token-item__inputs">
        <input class="css-token-item__color" data-css-token-color="${escapeHtml(token.name)}" type="color" value="${escapeHtml(toColorInputValue(token.value))}" />
        <input class="css-token-item__text" data-css-token-text="${escapeHtml(token.name)}" type="text" value="${escapeHtml(token.value)}" />
      </span>
    </label>
  `).join('');
  return tokens;
}

function syncSectionNoteEditor(state = store.getState()) {
  if (!elements.sectionNoteInput || !elements.sectionNoteSummary) return;
  const selectedUids = getSectionPanelSelection(state.editorMeta);
  const firstUid = selectedUids[0] || state.editorMeta?.selectedSectionUid || '';
  const sections = activeEditor?.listEditableSections?.() || [];
  const section = sections.find((item) => item.uid === firstUid) || null;
  elements.sectionNoteInput.disabled = !section;
  if (!section) {
    elements.sectionNoteInput.value = '';
    elements.sectionNoteSummary.textContent = '섹션 하나를 선택하면 메모를 남길 수 있습니다.';
    return;
  }
  elements.sectionNoteInput.value = section.note || '';
  elements.sectionNoteSummary.textContent = selectedUids.length > 1 ? `현재 ${selectedUids.length}개 중 첫 섹션 메모를 보고 있습니다.` : '저장 HTML에는 data-section-note와 주석이 같이 남습니다.';
}

function countRegexMatches(source, regex) {
  const matches = String(source || '').match(regex);
  return matches ? matches.length : 0;
}

function getLineColumnFromIndex(source, index) {
  const safeSource = String(source || '');
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, safeSource.length));
  const lines = safeSource.slice(0, safeIndex).split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1] || '').length + 1,
  };
}

function lineStartIndex(source, line) {
  const safeSource = String(source || '');
  const target = Math.max(1, Number(line) || 1);
  if (target <= 1) return 0;
  let currentLine = 1;
  for (let index = 0; index < safeSource.length; index += 1) {
    if (safeSource[index] === '\n') {
      currentLine += 1;
      if (currentLine === target) return index + 1;
    }
  }
  return safeSource.length;
}

function findPatternPosition(source, pattern) {
  const safeSource = String(source || '');
  const match = safeSource.match(pattern);
  if (!match || match.index == null) return { line: 1, column: 1, index: 0 };
  const position = getLineColumnFromIndex(safeSource, match.index);
  return { ...position, index: match.index };
}


function computeCodeDiffSummary(baseSource, draftSource) {
  const base = String(baseSource || '');
  const draft = String(draftSource || '');
  const baseLines = base.split(/\r?\n/);
  const draftLines = draft.split(/\r?\n/);
  const max = Math.max(baseLines.length, draftLines.length);
  let changedLines = 0;
  let firstChangedLine = 0;
  for (let index = 0; index < max; index += 1) {
    if ((baseLines[index] || '') !== (draftLines[index] || '')) {
      changedLines += 1;
      if (!firstChangedLine) firstChangedLine = index + 1;
    }
  }
  return {
    changedLines,
    firstChangedLine,
    addedLines: Math.max(0, draftLines.length - baseLines.length),
    removedLines: Math.max(0, baseLines.length - draftLines.length),
    draftLines: draftLines.length,
    draftChars: draft.length,
  };
}

function getCodeSourceLabel(key) {
  const sourceKey = String(key || '');
  if (sourceKey === 'draft') return '현재 초안';
  if (sourceKey === 'edited') return '편집본 HTML';
  if (sourceKey === 'normalized') return '정규화 HTML';
  if (sourceKey === 'original') return '원본 HTML';
  if (sourceKey === 'report') return '리포트 JSON';
  if (sourceKey === 'current-source') {
    return currentCodeSource === 'normalized'
      ? '현재 보기 (정규화 HTML)'
      : currentCodeSource === 'original'
        ? '현재 보기 (원본 HTML)'
        : currentCodeSource === 'report'
          ? '현재 보기 (리포트 JSON)'
          : '현재 보기 (편집 HTML)';
  }
  return '비교 소스';
}

function resolveCodeSourceValue(key) {
  const sourceKey = String(key || 'current-source');
  const state = store.getState();
  const project = state?.project || null;
  if (sourceKey === 'draft') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: elements.codeEditorTextarea?.value || '' };
  if (sourceKey === 'current-source') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: currentProjectHtmlText(state) || '' };
  if (!project) return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: '' };
  if (sourceKey === 'edited') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: elements.editedCodeView?.textContent || '' };
  if (sourceKey === 'normalized') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: project.normalizedHtml || '' };
  if (sourceKey === 'original') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: project.originalHtml || '' };
  if (sourceKey === 'report') return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: JSON.stringify(buildReportPayload(project, getEditorReport(project)), null, 2) };
  return { key: sourceKey, label: getCodeSourceLabel(sourceKey), text: '' };
}


function syncCodeCompareCompactControls() {
  if (elements.codeComparePresetSelect) {
    const desired = codeCompareBaseMode === 'original' && codeCompareTargetMode === 'edited'
      ? 'edited-vs-original'
      : codeCompareBaseMode === 'normalized' && codeCompareTargetMode === 'edited'
        ? 'edited-vs-normalized'
        : 'draft-vs-current';
    elements.codeComparePresetSelect.value = desired;
  }
  if (elements.codeCompareIssuesOnlyButton) {
    elements.codeCompareIssuesOnlyButton.classList.toggle('is-active', !!codeCompareIssuesOnly);
    elements.codeCompareIssuesOnlyButton.textContent = codeCompareIssuesOnly ? '이슈 연결만 ON' : '이슈 연결만';
  }
  if (elements.codeCompareColorOnlyButton) {
    elements.codeCompareColorOnlyButton.classList.toggle('is-active', !!codeCompareColorOnly);
    elements.codeCompareColorOnlyButton.textContent = codeCompareColorOnly ? '색상 변경만 ON' : '색상 변경만';
  }
}

function syncCodeCompareOptionLabels() {
  const updateSelect = (select) => {
    if (!select) return;
    const option = Array.from(select.options || []).find((item) => item.value === 'current-source');
    if (option) option.textContent = getCodeSourceLabel('current-source');
  };
  updateSelect(elements.codeCompareBaseSelect);
  updateSelect(elements.codeCompareTargetSelect);
}

function applyCodeComparePreset(preset = 'draft-vs-current') {
  const key = String(preset || 'draft-vs-current');
  if (key === 'edited-vs-original') {
    codeCompareBaseMode = 'original';
    codeCompareTargetMode = 'edited';
  } else if (key === 'edited-vs-normalized') {
    codeCompareBaseMode = 'normalized';
    codeCompareTargetMode = 'edited';
  } else if (key === 'current-vs-original') {
    codeCompareBaseMode = 'original';
    codeCompareTargetMode = 'current-source';
  } else {
    codeCompareBaseMode = 'current-source';
    codeCompareTargetMode = 'draft';
  }
  if (elements.codeCompareBaseSelect) elements.codeCompareBaseSelect.value = codeCompareBaseMode;
  if (elements.codeCompareTargetSelect) elements.codeCompareTargetSelect.value = codeCompareTargetMode;
  renderCodeComparePanel();
}

function shouldUseCodeCompareWorker(baseSource, targetSource) {
  const base = String(baseSource || '');
  const target = String(targetSource || '');
  const combinedChars = base.length + target.length;
  const combinedLines = base.split('\n').length + target.split('\n').length;
  return combinedChars >= 120000 || combinedLines >= 5200;
}

function ensureCodeCompareWorker() {
  if (codeCompareWorkerInstance) return codeCompareWorkerInstance;
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const source = `
    self.onmessage = (event) => {
      const payload = event.data || {};
      const base = String(payload.baseSource || '');
      const target = String(payload.targetSource || '');
      const maxPreviewChunks = Math.max(4, Number(payload.maxPreviewChunks || 24));
      function findSync(baseLines, targetLines, startBase, startTarget, lookahead = 24) {
        let best = null;
        for (let offsetSum = 1; offsetSum <= lookahead * 2; offsetSum += 1) {
          for (let baseOffset = 0; baseOffset <= Math.min(lookahead, offsetSum); baseOffset += 1) {
            const targetOffset = offsetSum - baseOffset;
            if (targetOffset > lookahead) continue;
            const baseLine = baseLines[startBase + baseOffset];
            const targetLine = targetLines[startTarget + targetOffset];
            if (baseLine == null || targetLine == null) continue;
            if (baseLine === targetLine) {
              best = { baseOffset, targetOffset };
              break;
            }
          }
          if (best) break;
        }
        return best;
      }
      function compute(baseText, targetText, limit) {
        const baseLines = baseText.split(/\r?\n/);
        const targetLines = targetText.split(/\r?\n/);
        const chunks = [];
        let baseIndex = 0;
        let targetIndex = 0;
        let changedLines = 0;
        let addedLines = 0;
        let removedLines = 0;
        let truncated = false;
        while ((baseIndex < baseLines.length || targetIndex < targetLines.length) && chunks.length < limit) {
          if (baseIndex < baseLines.length && targetIndex < targetLines.length && baseLines[baseIndex] === targetLines[targetIndex]) {
            baseIndex += 1;
            targetIndex += 1;
            continue;
          }
          const startBase = baseIndex;
          const startTarget = targetIndex;
          if (baseIndex >= baseLines.length) {
            targetIndex = targetLines.length;
          } else if (targetIndex >= targetLines.length) {
            baseIndex = baseLines.length;
          } else {
            const sync = findSync(baseLines, targetLines, baseIndex, targetIndex);
            if (sync) {
              baseIndex += sync.baseOffset;
              targetIndex += sync.targetOffset;
            } else {
              baseIndex = baseLines.length;
              targetIndex = targetLines.length;
            }
          }
          const removedSegment = baseLines.slice(startBase, baseIndex);
          const addedSegment = targetLines.slice(startTarget, targetIndex);
          if (!removedSegment.length && !addedSegment.length) continue;
          const kind = removedSegment.length && addedSegment.length ? 'modified' : removedSegment.length ? 'removed' : 'added';
          changedLines += Math.max(removedSegment.length, addedSegment.length);
          addedLines += addedSegment.length;
          removedLines += removedSegment.length;
          chunks.push({
            kind,
            baseStartLine: startBase + 1,
            baseEndLine: startBase + removedSegment.length,
            targetStartLine: startTarget + 1,
            targetEndLine: startTarget + addedSegment.length,
            removedLines: removedSegment,
            addedLines: addedSegment,
          });
        }
        if ((baseIndex < baseLines.length || targetIndex < targetLines.length) && chunks.length >= limit) truncated = true;
        return { chunkCount: chunks.length, changedLines, addedLines, removedLines, truncated, chunks };
      }
      try {
        const result = compute(base, target, maxPreviewChunks);
        self.postMessage({ requestId: payload.requestId, ok: true, result });
      } catch (error) {
        self.postMessage({ requestId: payload.requestId, ok: false, error: error && error.message ? error.message : String(error || 'diff worker error') });
      }
    };
  `;
  codeCompareWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  codeCompareWorkerInstance = new Worker(codeCompareWorkerUrl);
  window.addEventListener('beforeunload', () => {
    try { codeCompareWorkerInstance?.terminate?.(); } catch {}
    try { if (codeCompareWorkerUrl) URL.revokeObjectURL(codeCompareWorkerUrl); } catch {}
  }, { once: true });
  return codeCompareWorkerInstance;
}

function computeCodeCompareResultAsync(baseSource, targetSource, { maxPreviewChunks = 24 } = {}) {
  const worker = ensureCodeCompareWorker();
  if (!worker) return Promise.resolve(computeCodeCompareResult(baseSource, targetSource, { maxPreviewChunks }));
  const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const handleMessage = (event) => {
      const payload = event.data || {};
      if (payload.requestId !== requestId) return;
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      if (payload.ok) resolve(payload.result || computeCodeCompareResult(baseSource, targetSource, { maxPreviewChunks }));
      else reject(new Error(payload.error || 'diff worker failed'));
    };
    const handleError = (error) => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      reject(error instanceof Error ? error : new Error('diff worker error'));
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage({ requestId, baseSource, targetSource, maxPreviewChunks });
  });
}

function findCodeDiffSyncOffset(baseLines, targetLines, startBase, startTarget, lookahead = 24) {
  let best = null;
  for (let offsetSum = 1; offsetSum <= lookahead * 2; offsetSum += 1) {
    for (let baseOffset = 0; baseOffset <= Math.min(lookahead, offsetSum); baseOffset += 1) {
      const targetOffset = offsetSum - baseOffset;
      if (targetOffset > lookahead) continue;
      const baseLine = baseLines[startBase + baseOffset];
      const targetLine = targetLines[startTarget + targetOffset];
      if (baseLine == null || targetLine == null) continue;
      if (baseLine === targetLine) {
        best = { baseOffset, targetOffset };
        break;
      }
    }
    if (best) break;
  }
  return best;
}

function computeCodeCompareResult(baseSource, targetSource, { maxPreviewChunks = 24 } = {}) {
  const base = String(baseSource || '');
  const target = String(targetSource || '');
  if (lastCodeCompareCache.result && lastCodeCompareCache.baseText === base && lastCodeCompareCache.targetText === target) {
    return lastCodeCompareCache.result;
  }
  const baseLines = base.split(/\r?\n/);
  const targetLines = target.split(/\r?\n/);
  const chunks = [];
  let baseIndex = 0;
  let targetIndex = 0;
  let changedLines = 0;
  let addedLines = 0;
  let removedLines = 0;
  let truncated = false;

  while ((baseIndex < baseLines.length || targetIndex < targetLines.length) && chunks.length < maxPreviewChunks) {
    if (baseIndex < baseLines.length && targetIndex < targetLines.length && baseLines[baseIndex] === targetLines[targetIndex]) {
      baseIndex += 1;
      targetIndex += 1;
      continue;
    }

    const startBase = baseIndex;
    const startTarget = targetIndex;

    if (baseIndex >= baseLines.length) {
      targetIndex = targetLines.length;
    } else if (targetIndex >= targetLines.length) {
      baseIndex = baseLines.length;
    } else {
      const sync = findCodeDiffSyncOffset(baseLines, targetLines, baseIndex, targetIndex);
      if (sync) {
        baseIndex += sync.baseOffset;
        targetIndex += sync.targetOffset;
      } else {
        baseIndex = baseLines.length;
        targetIndex = targetLines.length;
      }
    }

    const removedSegment = baseLines.slice(startBase, baseIndex);
    const addedSegment = targetLines.slice(startTarget, targetIndex);
    if (!removedSegment.length && !addedSegment.length) continue;
    const kind = removedSegment.length && addedSegment.length ? 'modified' : removedSegment.length ? 'removed' : 'added';
    changedLines += Math.max(removedSegment.length, addedSegment.length);
    addedLines += addedSegment.length;
    removedLines += removedSegment.length;
    chunks.push({
      kind,
      baseStartLine: startBase + 1,
      baseEndLine: startBase + removedSegment.length,
      targetStartLine: startTarget + 1,
      targetEndLine: startTarget + addedSegment.length,
      removedLines: removedSegment,
      addedLines: addedSegment,
    });
  }

  if ((baseIndex < baseLines.length || targetIndex < targetLines.length) && chunks.length >= maxPreviewChunks) truncated = true;

  const result = {
    chunkCount: chunks.length,
    changedLines,
    addedLines,
    removedLines,
    truncated,
    chunks,
  };
  lastCodeCompareCache = { baseText: base, targetText: target, result };
  return result;
}

function formatCodeCompareLines(lines, prefix, limit = 10) {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (!safeLines.length) return '';
  const visible = safeLines.slice(0, limit);
  const rendered = visible.map((line) => `${prefix} ${line}`);
  if (safeLines.length > limit) rendered.push(`${prefix} … (${safeLines.length - limit}줄 더 있음)`);
  return escapeHtml(rendered.join('\n'));
}

function buildCodeCompareChunkKey(compareResult, chunk, index) {
  if (!compareResult || !chunk) return `chunk:${index}`;
  return [
    compareResult.baseKey || 'base',
    compareResult.targetKey || 'target',
    index,
    chunk.baseStartLine,
    chunk.baseEndLine,
    chunk.targetStartLine,
    chunk.targetEndLine,
    chunk.kind,
  ].join(':');
}

function renderCodeCompareChunkBody(compareResult, index) {
  const chunk = compareResult?.chunks?.[index];
  if (!chunk) return '<div class="code-compare-empty">변경 덩어리를 찾지 못했습니다.</div>';
  const baseSource = { key: compareResult.baseKey, label: compareResult.baseLabel };
  const targetSource = { key: compareResult.targetKey, label: compareResult.targetLabel };
  return `
    <section class="code-compare-side code-compare-side--base">
      <div class="code-compare-side__title">
        <span>${escapeHtml(baseSource.label)}</span>
        ${chunk.baseEndLine >= chunk.baseStartLine ? `<button class="button button--ghost button--small" data-code-compare-jump-source="${escapeHtml(baseSource.key)}" data-code-compare-jump-line="${chunk.baseStartLine}" type="button">${chunk.baseStartLine}줄로</button>` : ''}
      </div>
      <pre class="code-compare-lines"><code>${formatCodeCompareLines(chunk.removedLines, '-', 18) || '같은 줄만 있습니다.'}</code></pre>
    </section>
    <section class="code-compare-side code-compare-side--target">
      <div class="code-compare-side__title">
        <span>${escapeHtml(targetSource.label)}</span>
        ${chunk.targetEndLine >= chunk.targetStartLine ? `<button class="button button--ghost button--small" data-code-compare-jump-source="${escapeHtml(targetSource.key)}" data-code-compare-jump-line="${chunk.targetStartLine}" type="button">${chunk.targetStartLine}줄로</button>` : ''}
      </div>
      <pre class="code-compare-lines"><code>${formatCodeCompareLines(chunk.addedLines, '+', 18) || '같은 줄만 있습니다.'}</code></pre>
    </section>
  `;
}

function hydrateCodeCompareChunk(details) {
  if (!(details instanceof HTMLElement) || details.dataset.chunkHydrated === '1' || !details.open) return;
  const index = Number(details.dataset.chunkIndex || -1);
  if (index < 0) return;
  const body = details.querySelector('[data-code-compare-body]');
  if (!(body instanceof HTMLElement)) return;
  body.innerHTML = renderCodeCompareChunkBody(lastCodeCompareResult, index);
  details.dataset.chunkHydrated = '1';
}

function attachCodeCompareToggleHandlers() {
  for (const details of Array.from(elements.codeCompareList?.querySelectorAll?.('[data-code-compare-chunk]') || [])) {
    if (details.dataset.toggleBound === '1') continue;
    details.dataset.toggleBound = '1';
    details.addEventListener('toggle', () => {
      const index = Number(details.dataset.chunkIndex || -1);
      const chunk = lastCodeCompareResult?.chunks?.[index] || null;
      const key = buildCodeCompareChunkKey(lastCodeCompareResult, chunk, index);
      const disclosure = details.querySelector('.code-compare-item__disclosure');
      if (details.open) {
        codeCompareExpandedChunkKeys.add(key);
        hydrateCodeCompareChunk(details);
        if (disclosure) disclosure.textContent = '접기';
      } else {
        codeCompareExpandedChunkKeys.delete(key);
        if (disclosure) disclosure.textContent = '펼치기';
      }
    });
    if (details.open) hydrateCodeCompareChunk(details);
  }
}

function jumpToCodeCompareSource(sourceKey, line) {
  const targetLine = Math.max(1, Number(line) || 1);
  const key = String(sourceKey || 'draft');
  if (key === 'draft') {
    jumpCodeEditorToLine(targetLine, 1);
    setStatus(`현재 초안 ${targetLine}줄로 이동했습니다.`);
    return;
  }
  const nextSource = key === 'current-source' ? currentCodeSource : key;
  if (nextSource !== currentCodeSource) setCodeSource(nextSource, { preserveDraft: false });
  requestAnimationFrame(() => {
    jumpCodeEditorToLine(targetLine, 1);
  });
  setStatus(`${getCodeSourceLabel(key)} ${targetLine}줄로 이동했습니다.`);
}

function renderCodeComparePanel() {
  syncCodeCompareOptionLabels();
  syncCodeCompareCompactControls();
  const state = store.getState();
  if (!elements.codeCompareSummary || !elements.codeCompareList) return lastCodeCompareResult;
  if (!state.project) {
    elements.codeCompareSummary.textContent = '문서를 열면 편집본·정규화·원본과 현재 초안을 비교해 볼 수 있습니다.';
    elements.codeCompareList.innerHTML = '<div class="code-compare-empty">비교할 문서가 아직 없습니다.</div>';
    lastCodeCompareResult = { ...lastCodeCompareResult, chunkCount: 0, changedLines: 0, addedLines: 0, removedLines: 0, chunks: [], truncated: false };
    return lastCodeCompareResult;
  }
  const baseSource = resolveCodeSourceValue(codeCompareBaseMode);
  const targetSource = resolveCodeSourceValue(codeCompareTargetMode);
  const token = ++codeCompareRenderToken;

  const finalize = (rawResult) => {
    if (token !== codeCompareRenderToken) return lastCodeCompareResult;
    const result = rawResult || { chunkCount: 0, changedLines: 0, addedLines: 0, removedLines: 0, truncated: false, chunks: [] };
    const chunkIssues = collectDraftIssuesForCompareChunks({ ...result, baseKey: baseSource.key, targetKey: targetSource.key }, codeWorkbenchDiagnostics);
    lastCodeCompareResult = { ...result, baseKey: baseSource.key, targetKey: targetSource.key, baseLabel: baseSource.label, targetLabel: targetSource.label, chunkIssues };
    if (baseSource.text === targetSource.text) {
      elements.codeCompareSummary.textContent = `${baseSource.label} ↔ ${targetSource.label} 비교 결과 차이가 없습니다.`;
      elements.codeCompareList.innerHTML = '<div class="code-compare-empty">두 소스가 동일합니다. 편집 후 다시 비교해 보세요.</div>';
      return lastCodeCompareResult;
    }
    const totalChunkCount = result.chunkCount;
    const displayIndexes = result.chunks.map((_, index) => index).filter((index) => {
      if (codeCompareIssuesOnly && Number(lastCodeCompareResult.chunkIssues?.[index]?.length || 0) <= 0) return false;
      if (codeCompareColorOnly && !chunkLooksColorRelated(result.chunks[index])) return false;
      return true;
    });
    const summaryParts = [`${baseSource.label} ↔ ${targetSource.label}`, `${displayIndexes.length} / ${totalChunkCount}개 변경 덩어리`, `${result.changedLines}줄 차이`];
    if (result.addedLines) summaryParts.push(`+${result.addedLines}줄`);
    if (result.removedLines) summaryParts.push(`-${result.removedLines}줄`);
    if (result.truncated) summaryParts.push('미리보기 일부만 표시');
    if (codeCompareIssuesOnly) summaryParts.push('검사 연결만');
    if (codeCompareColorOnly) summaryParts.push('색상 변경만');
    if (shouldUseCodeCompareWorker(baseSource.text, targetSource.text)) summaryParts.push('worker 계산');
    elements.codeCompareSummary.textContent = summaryParts.join(' · ');
    if (!result.chunks.length) {
      elements.codeCompareList.innerHTML = '<div class="code-compare-empty">차이를 계산할 수 없었습니다.</div>';
      return lastCodeCompareResult;
    }
    if (!displayIndexes.length) {
      elements.codeCompareList.innerHTML = '<div class="code-compare-empty">검사와 연결된 변경 덩어리가 없습니다.</div>';
      return lastCodeCompareResult;
    }
    elements.codeCompareList.innerHTML = displayIndexes.map((index) => {
      const chunk = result.chunks[index];
      const baseRange = chunk.baseEndLine >= chunk.baseStartLine ? `${chunk.baseStartLine}~${chunk.baseEndLine}줄` : '없음';
      const targetRange = chunk.targetEndLine >= chunk.targetStartLine ? `${chunk.targetStartLine}~${chunk.targetEndLine}줄` : '없음';
      const kindLabel = chunk.kind === 'added' ? '추가' : chunk.kind === 'removed' ? '삭제' : '수정';
      const chunkKey = buildCodeCompareChunkKey(lastCodeCompareResult, chunk, index);
      const issueCount = Number(lastCodeCompareResult.chunkIssues?.[index]?.length || 0);
      const defaultOpen = issueCount > 0 ? true : (displayIndexes.length <= 4 ? displayIndexes[0] === index : codeCompareExpandedChunkKeys.has(chunkKey));
      return `
        <details class="code-compare-item ${issueCount ? 'is-issue-linked' : ''}" data-kind="${escapeHtml(chunk.kind)}" data-code-compare-chunk="1" data-chunk-index="${index}" ${defaultOpen ? 'open' : ''}>
          <summary class="code-compare-item__summary">
            <div class="code-compare-item__top">
              <div class="code-compare-item__meta">
                <span class="code-compare-pill" data-kind="${escapeHtml(chunk.kind)}">${escapeHtml(kindLabel)}</span>
                <span class="mini-summary">#${index + 1}</span>
                <span class="mini-summary">기준 ${escapeHtml(baseRange)}</span>
                <span class="mini-summary">비교 ${escapeHtml(targetRange)}</span>
                ${issueCount ? `<span class="mini-summary">검사 연결 ${issueCount}개</span>` : ''}
                ${chunkLooksColorRelated(chunk) ? `<span class="mini-summary">색상 변경</span>` : ''}
              </div>
              <span class="code-compare-item__disclosure">${defaultOpen ? '접기' : '펼치기'}</span>
            </div>
          </summary>
          <div class="code-compare-item__body" data-code-compare-body></div>
        </details>
      `;
    }).join('');
    attachCodeCompareToggleHandlers();
    return lastCodeCompareResult;
  };

  if (baseSource.text === targetSource.text) {
    return finalize({ chunkCount: 0, changedLines: 0, addedLines: 0, removedLines: 0, truncated: false, chunks: [] });
  }

  if (shouldUseCodeCompareWorker(baseSource.text, targetSource.text)) {
    elements.codeCompareSummary.textContent = `${baseSource.label} ↔ ${targetSource.label} 비교 계산 중…`;
    elements.codeCompareList.innerHTML = '<div class="code-compare-empty">긴 HTML diff를 worker에서 계산하고 있습니다…</div>';
    computeCodeCompareResultAsync(baseSource.text, targetSource.text)
      .then((result) => finalize(result))
      .catch(() => finalize(computeCodeCompareResult(baseSource.text, targetSource.text)));
    return { ...lastCodeCompareResult, pending: true };
  }

  return finalize(computeCodeCompareResult(baseSource.text, targetSource.text));
}

function suggestCodeComparePresetForIssue(issue = null) {
  const haystack = `${issue?.title || ''} ${issue?.message || ''}`.toLowerCase();
  if (/uploaded|플레이스홀더|script|iframe|인라인 이벤트/.test(haystack)) return 'edited-vs-original';
  if (/body|html|section|page 래퍼|정규화/.test(haystack)) return 'edited-vs-normalized';
  return 'draft-vs-current';
}

function collectDraftIssuesForCompareChunks(compareResult, issues = []) {
  if (!Array.isArray(compareResult?.chunks) || !compareResult.chunks.length) return [];
  const usesDraftInTarget = compareResult.targetKey === 'draft';
  const usesDraftInBase = compareResult.baseKey === 'draft';
  if (!usesDraftInTarget && !usesDraftInBase) return [];
  return compareResult.chunks.map((chunk) => {
    const matches = issues.filter((issue) => {
      const line = Number(issue?.line || 0);
      if (line <= 0) return false;
      if (usesDraftInTarget) return line >= chunk.targetStartLine && line <= Math.max(chunk.targetStartLine, chunk.targetEndLine);
      if (usesDraftInBase) return line >= chunk.baseStartLine && line <= Math.max(chunk.baseStartLine, chunk.baseEndLine);
      return false;
    });
    return matches;
  });
}

function buildCodeDraftDiagnostics(html, project = null) {
  const source = String(html || '');
  const issues = [];
  const addIssue = (level, title, message, pattern = null) => {
    const position = pattern ? findPatternPosition(source, pattern) : { line: 1, column: 1, index: 0 };
    issues.push({ level, title, message, line: position.line, column: position.column });
  };

  if (!source.trim()) {
    addIssue('error', '비어 있는 코드', '적용할 코드가 비어 있습니다. HTML 내용을 입력하거나 캔버스에서 다시 불러오세요.');
    return issues;
  }

  const bodyOpenCount = countRegexMatches(source, /<body\b/gi);
  if (bodyOpenCount > 1) addIssue('error', '<body> 중복', '<body> 태그가 두 번 이상 있으면 문서 구조가 꼬일 수 있습니다.', /<body\b/i);

  const htmlOpenCount = countRegexMatches(source, /<html\b/gi);
  if (htmlOpenCount > 1) addIssue('error', '<html> 중복', '<html> 태그가 두 번 이상 있으면 브라우저가 예측 불가능하게 보정할 수 있습니다.', /<html\b/i);

  if (/<body\b/i.test(source) && !/<\/body>/i.test(source)) addIssue('warning', '</body> 누락', 'body 닫힘 태그가 없어도 브라우저가 보정하지만, 저장/재적용 시 구조가 달라질 수 있습니다.', /<body\b/i);
  if (/<html\b/i.test(source) && !/<\/html>/i.test(source)) addIssue('warning', '</html> 누락', 'html 닫힘 태그가 없어서 정규화 시 줄 재배치가 생길 수 있습니다.', /<html\b/i);

  const openSections = countRegexMatches(source, /<section\b/gi);
  const closeSections = countRegexMatches(source, /<\/section>/gi);
  if (openSections !== closeSections) addIssue('warning', 'section 개수 차이', `열린 section ${openSections}개, 닫힌 section ${closeSections}개입니다.`, /<section\b/i);

  if (!/class\s*=\s*["'][^"']*\bpage\b/i.test(source)) addIssue('info', '.page 래퍼 없음', '페이지 래퍼(.page)가 없으면 일부 상세페이지 규칙이 덜 안정적으로 동작할 수 있습니다.');

  const placeholderCount = countRegexMatches(source, /\[이미지 삽입부\]/g);
  if (placeholderCount > 0) addIssue('info', '플레이스홀더 남아 있음', `아직 [이미지 삽입부]가 ${placeholderCount}개 남아 있습니다.`, /\[이미지 삽입부\]/);

  if (/<script\b/i.test(source)) addIssue('warning', 'script 태그 포함', '로컬 편집기에서는 script가 미리보기/정규화 시 예상과 다르게 동작할 수 있습니다.', /<script\b/i);
  if (/<iframe\b/i.test(source)) addIssue('warning', 'iframe 태그 포함', 'iframe은 로컬 파일 보안 정책에 따라 차단되거나 비어 보일 수 있습니다.', /<iframe\b/i);
  if (/\bon[a-z]+\s*=\s*["'][^"']*["']/i.test(source)) addIssue('warning', '인라인 이벤트 포함', 'onclick/onload 같은 인라인 이벤트는 local preview와 export에서 일관성이 떨어질 수 있습니다.', /\bon[a-z]+\s*=\s*["'][^"']*["']/i);

  const uploadedRefs = countRegexMatches(source, /uploaded:[^"' )]+/g);
  const baselineUploadedRefs = countRegexMatches(project?.normalizedHtml || project?.originalHtml || '', /uploaded:[^"' )]+/g);
  if (baselineUploadedRefs > 0 && uploadedRefs < baselineUploadedRefs) {
    addIssue('warning', 'uploaded: 참조 감소', `기준 문서보다 uploaded: 이미지 참조가 줄었습니다. (${uploadedRefs}/${baselineUploadedRefs})`, /uploaded:[^"' )]+/);
  }

  return issues;
}

function renderCodeValidationList(issues) {
  if (!elements.codeValidationList) return;
  if (!issues.length) {
    elements.codeValidationList.innerHTML = '<div class="code-validation-empty">큰 구조 위험은 보이지 않습니다. 필요하면 적용 전 검사를 다시 눌러 최신 상태를 확인하세요.</div>';
    return;
  }
  elements.codeValidationList.innerHTML = issues.map((issue) => {
    const levelLabel = issue.level === 'error' ? '오류' : issue.level === 'warning' ? '주의' : '안내';
    const lineText = Number(issue.line || 0) > 0 ? `${issue.line}줄` : '위치 없음';
    return `
      <article class="code-validation-item" data-level="${escapeHtml(issue.level)}">
        <div class="code-validation-item__top">
          <span class="code-validation-item__level">${escapeHtml(levelLabel)}</span>
          <span class="mini-summary">${escapeHtml(lineText)}</span>
        </div>
        <div class="code-validation-item__title">${escapeHtml(issue.title)}</div>
        <div class="code-validation-item__desc">${escapeHtml(issue.message)}</div>
        <div class="button-row button-row--compact">
          <button class="button button--ghost button--small code-validation-item__jump" data-code-jump-line="${Number(issue.line || 1)}" data-code-jump-column="${Number(issue.column || 1)}" type="button">해당 줄 보기</button>
          <button class="button button--ghost button--small" data-code-open-compare="1" data-code-compare-preset="${escapeHtml(suggestCodeComparePresetForIssue(issue))}" data-code-jump-line="${Number(issue.line || 1)}" data-code-jump-column="${Number(issue.column || 1)}" type="button">비교 보기</button>
        </div>
      </article>
    `;
  }).join('');
}

function jumpCodeEditorToLine(line, column = 1) {
  const textarea = elements.codeEditorTextarea;
  if (!textarea) return false;
  const lineIndex = Math.max(1, Number(line) || 1);
  const columnIndex = Math.max(1, Number(column) || 1);
  const start = lineStartIndex(textarea.value || '', lineIndex);
  const target = Math.max(0, start + columnIndex - 1);
  textarea.focus();
  textarea.setSelectionRange(target, target);
  const lineHeight = 20;
  textarea.scrollTop = Math.max(0, (lineIndex - 3) * lineHeight);
  return true;
}

function syncCodeCursorInfo() {
  if (!elements.codeCursorInfo || !elements.codeEditorTextarea) return;
  const textarea = elements.codeEditorTextarea;
  const position = getLineColumnFromIndex(textarea.value || '', textarea.selectionStart || 0);
  elements.codeCursorInfo.textContent = `${position.line}줄 · ${position.column}칸`;
}

function syncCodeWorkbenchState({ announce = false } = {}) {
  const textarea = elements.codeEditorTextarea;
  if (!textarea) return [];
  const state = store.getState();
  const reference = currentProjectHtmlText(state) || '';
  const draft = textarea.value || '';
  const diff = computeCodeDiffSummary(reference, draft);
  lastCodeDiffSummary = diff;
  const hasProject = !!state.project;
  codeWorkbenchDiagnostics = hasProject ? buildCodeDraftDiagnostics(draft, state.project) : [];
  syncCodeCursorInfo();

  if (elements.codeSyncStats) elements.codeSyncStats.textContent = `${diff.draftLines}줄 · ${diff.draftChars.toLocaleString('ko-KR')}자`;
  if (elements.codeDraftBadge) {
    let badgeState = 'clean';
    let badgeText = '캔버스와 동기화';
    if (!hasProject) {
      badgeState = 'clean';
      badgeText = '문서 없음';
    } else if (currentCodeSource === 'report') {
      badgeState = 'readonly';
      badgeText = '읽기 전용';
    } else if (codeWorkbenchDiagnostics.some((issue) => issue.level === 'error')) {
      badgeState = 'warning';
      badgeText = '오류 확인 필요';
    } else if (codeEditorDirty || diff.changedLines > 0) {
      badgeState = 'dirty';
      badgeText = diff.changedLines > 0 ? `${diff.changedLines}줄 변경` : '코드 초안 변경';
    }
    elements.codeDraftBadge.dataset.state = badgeState;
    elements.codeDraftBadge.textContent = badgeText;
  }

  if (elements.codeDiffSummary) {
    const sourceLabel = currentCodeSource === 'normalized'
      ? '정규화 HTML'
      : currentCodeSource === 'original'
        ? '원본 HTML'
        : currentCodeSource === 'report'
          ? '리포트 JSON'
          : '편집 HTML';
    if (!hasProject) {
      elements.codeDiffSummary.textContent = '문서를 열면 편집본·원본·정규화 HTML을 이 자리에서 비교할 수 있습니다.';
    } else if (currentCodeSource === 'report') {
      elements.codeDiffSummary.textContent = '리포트 JSON은 읽기 전용입니다. 복사·검토용으로 사용하세요.';
    } else if (!diff.changedLines) {
      elements.codeDiffSummary.textContent = `${sourceLabel} 기준으로 차이가 없습니다.`;
    } else {
      const parts = [`${sourceLabel} 기준 ${diff.changedLines}줄 변경`];
      if (diff.addedLines) parts.push(`${diff.addedLines}줄 추가`);
      if (diff.removedLines) parts.push(`${diff.removedLines}줄 감소`);
      if (diff.firstChangedLine) parts.push(`첫 변경 ${diff.firstChangedLine}줄`);
      elements.codeDiffSummary.textContent = parts.join(' · ');
    }
  }

  renderCodeValidationList(codeWorkbenchDiagnostics);
  renderCodeComparePanel();
  if (announce) {
    const errors = codeWorkbenchDiagnostics.filter((issue) => issue.level === 'error').length;
    const warnings = codeWorkbenchDiagnostics.filter((issue) => issue.level === 'warning').length;
    setStatus(errors ? `코드 검사: 오류 ${errors}개, 주의 ${warnings}개` : `코드 검사: 치명 오류 없음${warnings ? ` · 주의 ${warnings}개` : ''}`);
  }
  return codeWorkbenchDiagnostics;
}

function renderSelectionContextCard(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  const hasSelection = count > 0;
  if (elements.selectionContextCard) elements.selectionContextCard.hidden = !hasSelection;
  if (!hasSelection) {
    if (elements.selectionContextTitle) elements.selectionContextTitle.textContent = '선택 없음';
    if (elements.selectionContextMeta) elements.selectionContextMeta.textContent = '캔버스에서 요소를 선택하세요.';
    if (elements.selectionContextChips) elements.selectionContextChips.innerHTML = '';
    if (elements.selectionContextHint) elements.selectionContextHint.textContent = '요소를 선택하면 타입에 맞는 속성과 빠른 작업이 아래에 나타납니다.';
    return;
  }

  const type = resolvePrimarySelectionType(editorMeta);
  const selected = editorMeta?.selectedItems?.[0] || editorMeta?.selected || null;
  const label = count > 1 ? `다중 선택 ${count}개` : (selected?.label || '선택 요소');
  const tagName = selected?.tagName ? `<${String(selected.tagName).toLowerCase()}>` : '';
  const metaParts = [];
  if (count > 1) metaParts.push('정렬 / 간격 / 그룹 작업 가능');
  else {
    if (type === 'text') metaParts.push('텍스트 스타일 + 위치/크기 편집');
    else if (type === 'image') metaParts.push('이미지 교체 + 크롭 + 배치');
    else metaParts.push('위치/크기/레이어 편집');
    if (tagName) metaParts.push(tagName);
  }
  if (elements.selectionContextTitle) elements.selectionContextTitle.textContent = label;
  if (elements.selectionContextMeta) elements.selectionContextMeta.textContent = metaParts.join(' · ');
  const chips = [];
  if (count > 1) chips.push('<span class="selection-chip selection-chip--multi">다중</span>');
  if (type === 'image') chips.push('<span class="selection-chip selection-chip--slot">슬롯</span>');
  if (type === 'text') chips.push('<span class="selection-chip selection-chip--text">텍스트</span>');
  if (selected?.hidden) chips.push('<span class="selection-chip selection-chip--warn">숨김</span>');
  if (selected?.locked) chips.push('<span class="selection-chip selection-chip--danger">잠금</span>');
  if (selected?.imageLocked) chips.push('<span class="selection-chip selection-chip--warn">이미지 잠금</span>');
  if (selected?.textEditing) chips.push('<span class="selection-chip selection-chip--ok">텍스트 편집 중</span>');
  if (selected?.score) chips.push(`<span class="selection-chip">감지 ${Math.round(Number(selected.score) || 0)}</span>`);
  if (elements.selectionContextChips) elements.selectionContextChips.innerHTML = chips.join('');

  let hint = '위치/크기와 레이어 순서를 조절할 수 있습니다.';
  if (count > 1) hint = '여러 요소를 함께 골랐습니다. 아래에서 정렬, 간격, 같은 크기 맞춤을 한 번에 적용하세요.';
  else if (type === 'text') hint = '텍스트는 더블클릭 또는 텍스트 편집 버튼으로 바로 수정하고, 아래에서 스타일을 맞출 수 있습니다.';
  else if (type === 'image') {
    const reasons = Array.isArray(selected?.reasons) ? selected.reasons.slice(0, 2).join(' · ') : '';
    hint = reasons ? `이 슬롯은 ${reasons} 기준으로 감지되었습니다.` : '슬롯은 이미지 교체, 크롭, 채우기/맞춤, 미세이동을 바로 지원합니다.';
  }
  if (elements.selectionContextHint) elements.selectionContextHint.textContent = hint;
}

function syncImageInspector(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  const type = resolvePrimarySelectionType(editorMeta);
  const enabled = count === 1 && type === 'image';
  const cropActive = !!editorMeta?.cropActive;
  const selected = editorMeta?.selected || editorMeta?.selectedItems?.[0] || null;
  const imageLocked = !!selected?.imageLocked;
  if (elements.leftInspectorImageSection) elements.leftInspectorImageSection.hidden = !enabled;
  if (elements.imageInspectorSummary) {
    elements.imageInspectorSummary.textContent = enabled
      ? `${selected?.label || '선택 슬롯'}${selected?.score ? ` · 감지 ${Math.round(Number(selected.score) || 0)}` : ''}`
      : '이미지 미선택';
  }
  if (elements.imageInspectorHint) {
    elements.imageInspectorHint.textContent = !enabled
      ? '슬롯을 선택하면 교체, 크롭, 배치, 잠금을 이곳에서 바로 다룹니다.'
      : (imageLocked
        ? '현재 이미지가 잠겨 있어 교체/크롭/배치가 잠시 비활성화됩니다.'
        : (cropActive ? '크롭 모드가 활성화되었습니다. 적용 또는 취소로 마무리하세요.' : '더블클릭으로도 크롭 모드에 들어갈 수 있습니다.'));
  }
  const disabled = !enabled || (!cropActive && imageLocked);
  const actionButtons = [
    elements.inspectorReplaceImageButton,
    elements.inspectorCropModeButton,
    elements.inspectorRemoveImageButton,
    elements.inspectorPresetCoverButton,
    elements.inspectorPresetContainButton,
    elements.inspectorPresetTopButton,
    elements.inspectorPresetCenterButton,
    elements.inspectorPresetBottomButton,
    elements.inspectorImageNudgeLeftButton,
    elements.inspectorImageNudgeRightButton,
    elements.inspectorImageNudgeUpButton,
    elements.inspectorImageNudgeDownButton,
  ];
  for (const button of actionButtons) {
    if (!button) continue;
    button.disabled = disabled;
  }
  if (elements.inspectorImageLockButton) {
    elements.inspectorImageLockButton.disabled = !enabled;
    elements.inspectorImageLockButton.classList.toggle('is-active', enabled && imageLocked);
    elements.inspectorImageLockButton.textContent = enabled ? (imageLocked ? '이미지 잠금 해제' : '이미지 잠금') : '이미지 잠금';
  }
  if (elements.inspectorCropModeButton) {
    elements.inspectorCropModeButton.textContent = cropActive ? '크롭 적용' : '크롭 모드';
    elements.inspectorCropModeButton.classList.toggle('is-active', cropActive);
  }
  if (elements.inspectorRedetectButton) elements.inspectorRedetectButton.disabled = !activeEditor;
}

function syncCropHudControls(editorMeta) {
  const cropActive = !!editorMeta?.cropActive;
  const zoom = Math.max(35, Math.min(500, Math.round((Number(editorMeta?.cropZoom || 1) || 1) * 100)));
  const offsetX = Number(editorMeta?.cropOffsetX || 0) || 0;
  const offsetY = Number(editorMeta?.cropOffsetY || 0) || 0;
  const selected = editorMeta?.selected || editorMeta?.selectedItems?.[0] || null;
  const imageLocked = !!selected?.imageLocked;
  if (elements.cropFloatingChip) elements.cropFloatingChip.hidden = !cropActive;
  if (elements.cropControlStrip) {
    elements.cropControlStrip.hidden = !cropActive;
    elements.cropControlStrip.classList.toggle('is-locked', cropActive && imageLocked);
  }
  if (elements.cropFloatingHint) {
    elements.cropFloatingHint.textContent = cropActive
      ? (imageLocked ? '이미지 잠금이 켜져 있습니다. 잠금 해제 후 크롭을 편집하세요.' : '크롭 모드 · Enter 적용 · Esc 취소')
      : '크롭 모드 비활성';
  }
  if (elements.cropFloatingMeta) {
    elements.cropFloatingMeta.textContent = cropActive
      ? `${zoom}% · X ${Math.round(offsetX)} · Y ${Math.round(offsetY)} · 팬 휠 / 줌 Ctrl+휠`
      : '팬: 휠 · 줌: Ctrl/Cmd/Alt+휠';
  }
  if (elements.cropZoomSlider) {
    elements.cropZoomSlider.value = String(zoom);
    elements.cropZoomSlider.disabled = !cropActive || imageLocked;
    const fill = (zoom - 35) / (500 - 35);
    elements.cropZoomSlider.style.background = `linear-gradient(90deg, rgba(37,99,235,.22) 0%, rgba(37,99,235,.22) ${(fill * 100).toFixed(1)}%, rgba(226,232,240,.95) ${(fill * 100).toFixed(1)}%, rgba(226,232,240,.95) 100%)`;
  }
  if (elements.cropZoomValue) elements.cropZoomValue.textContent = `${zoom}%`;
  if (elements.cropLockBadge) elements.cropLockBadge.hidden = !cropActive || !imageLocked;
  const presetMode = String(editorMeta?.cropPresetMode || 'custom');
  const presetButtons = [
    [elements.cropPresetFitButton, 'fit'],
    [elements.cropPresetCoverButton, 'cover'],
    [elements.cropPresetActualButton, 'actual'],
    [elements.cropPresetResetButton, 'reset'],
  ];
  for (const [button, mode] of presetButtons) {
    if (!button) continue;
    button.disabled = !cropActive || imageLocked;
    button.classList.toggle('is-active', cropActive && presetMode === mode);
  }
}

function syncMultiArrangeTools(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  if (elements.multiArrangeTools) elements.multiArrangeTools.hidden = count < 2;
  if (elements.multiArrangeSummary) {
    elements.multiArrangeSummary.textContent = count >= 2 ? `${count}개 정렬 가능` : '2개 이상 선택 시 활성화';
  }
}

function openCodeWorkbench() {
  if (store.getState().project && currentCodeSource !== 'edited') setCodeSource('edited', { preserveDraft: false });
  setSidebarTab('left-start');
  document.getElementById('leftStartAdvancedDetails')?.setAttribute('open', '');
  document.getElementById('codeWorkbenchDetails')?.setAttribute('open', '');
  syncCodeFlowState();
  requestAnimationFrame(() => {
    elements.codeEditorTextarea?.focus();
    elements.codeEditorTextarea?.scrollIntoView?.({ block: 'nearest' });
  });
}

function getCanvasIntrinsicWidth() {
  const doc = elements.previewFrame?.contentDocument;
  return Math.max(860, doc?.documentElement?.scrollWidth || 0, doc?.body?.scrollWidth || 0);
}

function getCurrentPreviewScale() {
  const viewport = elements.previewViewport;
  if (!viewport) return zoomState.value;
  const intrinsic = getCanvasIntrinsicWidth();
  const fitScale = Math.max(0.35, Math.min(2.25, (viewport.clientWidth - 32) / intrinsic));
  return zoomState.mode === 'fit' ? fitScale : zoomState.value;
}

function measurePreviewFrameHeight() {
  const iframe = elements.previewFrame;
  const doc = iframe?.contentDocument;
  if (!iframe || !doc) return 0;
  const height = Math.max(
    960,
    Number(doc.documentElement?.scrollHeight || 0),
    Number(doc.body?.scrollHeight || 0),
    Number(doc.documentElement?.offsetHeight || 0),
    Number(doc.body?.offsetHeight || 0),
    Number(doc.documentElement?.clientHeight || 0),
    Number(doc.body?.clientHeight || 0),
  );
  return Math.ceil(height);
}

function flushPreviewFrameHeightSync() {
  const iframe = elements.previewFrame;
  if (!iframe) return;
  const nextHeight = measurePreviewFrameHeight();
  if (!nextHeight) return;
  const changed = Math.abs(nextHeight - lastPreviewFrameHeight) > 1;
  lastPreviewFrameHeight = nextHeight;
  iframe.style.height = `${nextHeight}px`;
  syncPreviewMinimap();
  if (changed) previewFrameHeightStabilizePasses = Math.max(previewFrameHeightStabilizePasses, 2);
}

function schedulePreviewHeightStabilization(passes = 6) {
  previewFrameHeightStabilizePasses = Math.max(previewFrameHeightStabilizePasses, passes);
  if (previewFrameHeightStabilizeRaf) return;
  const tick = () => {
    previewFrameHeightStabilizeRaf = 0;
    flushPreviewFrameHeightSync();
    if (previewFrameHeightStabilizePasses > 0) {
      previewFrameHeightStabilizePasses -= 1;
      previewFrameHeightStabilizeRaf = requestAnimationFrame(tick);
    }
  };
  previewFrameHeightStabilizeRaf = requestAnimationFrame(tick);
}

function syncPreviewFrameHeight({ stabilize = 0 } = {}) {
  if (previewFrameResizeRaf) cancelAnimationFrame(previewFrameResizeRaf);
  previewFrameResizeRaf = requestAnimationFrame(() => {
    previewFrameResizeRaf = 0;
    flushPreviewFrameHeightSync();
    if (stabilize > 0) schedulePreviewHeightStabilization(stabilize);
  });
}

function applyPreviewZoom() {
  const viewport = elements.previewViewport;
  const scaler = elements.previewScaler;
  if (!viewport || !scaler) return;
  const intrinsic = getCanvasIntrinsicWidth();
  scaler.style.width = `${intrinsic}px`;
  const scale = getCurrentPreviewScale();
  scaler.style.setProperty('--preview-scale', String(scale));
  if (elements.zoomLabel) elements.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  if (elements.zoomFitButton) elements.zoomFitButton.classList.toggle('is-active', zoomState.mode === 'fit');
  syncPreviewFrameHeight();
  syncPreviewMinimap();
}


function zoomPreviewAround(delta, clientX, clientY) {
  const viewport = elements.previewViewport;
  if (!viewport) return;
  const oldScale = getCurrentPreviewScale();
  const rect = viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const contentX = (viewport.scrollLeft + localX) / Math.max(oldScale, 0.001);
  const contentY = (viewport.scrollTop + localY) / Math.max(oldScale, 0.001);
  setZoom('manual', oldScale + delta);
  const newScale = getCurrentPreviewScale();
  viewport.scrollLeft = Math.max(0, contentX * newScale - localX);
  viewport.scrollTop = Math.max(0, contentY * newScale - localY);
}

function scrollPreviewByPage(direction = 1) {
  const viewport = elements.previewViewport;
  if (!viewport) return;
  viewport.scrollBy({ top: Math.round(viewport.clientHeight * 0.86 * direction), behavior: 'smooth' });
}

function scrollPreviewToEdge(edge = 'top') {
  const viewport = elements.previewViewport;
  if (!viewport) return;
  if (edge === 'bottom') viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  else viewport.scrollTo({ top: 0, behavior: 'smooth' });
}

function teardownPreviewFrameBindings() {
  if (typeof previewFrameBindingsCleanup === 'function') {
    try { previewFrameBindingsCleanup(); } catch {}
  }
  previewFrameBindingsCleanup = null;
  if (previewFrameResizeRaf) cancelAnimationFrame(previewFrameResizeRaf);
  if (previewFrameHeightStabilizeRaf) cancelAnimationFrame(previewFrameHeightStabilizeRaf);
  previewFrameResizeRaf = 0;
  previewFrameHeightStabilizeRaf = 0;
  previewFrameHeightStabilizePasses = 0;
}

function bindPreviewFrameInteractions() {
  teardownPreviewFrameBindings();
  const iframe = elements.previewFrame;
  const viewport = elements.previewViewport;
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow;
  if (!iframe || !viewport || !doc || !win) return;
  const wheelHandler = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    zoomPreviewAround(delta, event.clientX, event.clientY);
  };
  const mutationHandler = () => syncPreviewFrameHeight({ stabilize: 2 });
  const observer = new win.MutationObserver(mutationHandler);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  let resizeObserver = null;
  if (typeof win.ResizeObserver === 'function') {
    resizeObserver = new win.ResizeObserver(() => syncPreviewFrameHeight({ stabilize: 2 }));
    if (doc.documentElement) resizeObserver.observe(doc.documentElement);
    if (doc.body) resizeObserver.observe(doc.body);
  }
  const previewMediaCleanup = [];
  for (const media of Array.from(doc.images || [])) {
    const listener = () => syncPreviewFrameHeight({ stabilize: 10 });
    media.addEventListener('load', listener, { once: true });
    media.addEventListener('error', listener, { once: true });
    previewMediaCleanup.push(() => {
      media.removeEventListener('load', listener);
      media.removeEventListener('error', listener);
    });
  }
  const fontsReady = doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function' ? doc.fonts.ready : null;
  if (fontsReady) {
    fontsReady.then(() => {
      syncPreviewFrameHeight({ stabilize: 10 });
    }).catch(() => {});
  }
  const beginSpacePan = (event) => {
    if (!previewSpacePanArmed || isTypingInputTarget(event.target)) return;
    event.preventDefault();
    previewPanState = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.classList.add('is-panning');
  };
  const updateSpacePan = (event) => {
    if (!previewPanState) return;
    event.preventDefault();
    viewport.scrollLeft = Math.max(0, previewPanState.scrollLeft - (event.clientX - previewPanState.startX));
    viewport.scrollTop = Math.max(0, previewPanState.scrollTop - (event.clientY - previewPanState.startY));
    schedulePreviewMinimapSync();
  };
  const endSpacePan = () => {
    if (!previewPanState) return;
    previewPanState = null;
    viewport.classList.remove('is-panning');
    schedulePreviewMinimapSync();
  };
  const scrollHandler = () => schedulePreviewMinimapSync();
  doc.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
  viewport.addEventListener('wheel', wheelHandler, { passive: false });
  doc.addEventListener('mousedown', beginSpacePan, true);
  viewport.addEventListener('mousedown', beginSpacePan, true);
  win.addEventListener('mousemove', updateSpacePan, true);
  window.addEventListener('mousemove', updateSpacePan, true);
  win.addEventListener('mouseup', endSpacePan, true);
  window.addEventListener('mouseup', endSpacePan, true);
  viewport.addEventListener('scroll', scrollHandler, { passive: true });
  win.addEventListener('resize', syncPreviewFrameHeight);
  syncPreviewFrameHeight({ stabilize: 12 });
  syncPreviewMinimap();
  previewFrameBindingsCleanup = () => {
    observer.disconnect();
    resizeObserver?.disconnect?.();
    for (const cleanup of previewMediaCleanup) cleanup();
    doc.removeEventListener('wheel', wheelHandler, true);
    viewport.removeEventListener('wheel', wheelHandler, false);
    doc.removeEventListener('mousedown', beginSpacePan, true);
    viewport.removeEventListener('mousedown', beginSpacePan, true);
    win.removeEventListener('mousemove', updateSpacePan, true);
    window.removeEventListener('mousemove', updateSpacePan, true);
    win.removeEventListener('mouseup', endSpacePan, true);
    window.removeEventListener('mouseup', endSpacePan, true);
    viewport.removeEventListener('scroll', scrollHandler, false);
    win.removeEventListener('resize', syncPreviewFrameHeight);
    viewport.classList.remove('is-panning');
    previewPanState = null;
  };
}

function setZoom(mode, value = null) {
  if (mode === 'fit') {
    zoomState.mode = 'fit';
  } else {
    zoomState.mode = 'manual';
    const next = Number.isFinite(value) ? value : zoomState.value;
    zoomState.value = Math.max(0.35, Math.min(2.25, next));
  }
  applyPreviewZoom();
}

function nudgeZoom(delta) {
  const current = zoomState.mode === 'fit' ? Number.parseFloat((elements.zoomLabel?.textContent || '100').replace('%', '')) / 100 : zoomState.value;
  setZoom('manual', current + delta);
}

function syncWorkspaceButtons() {
  document.body.classList.toggle('layout--left-collapsed', document.body.classList.contains('layout--left-collapsed'));
  document.body.classList.toggle('layout--right-collapsed', document.body.classList.contains('layout--right-collapsed'));
  if (elements.toggleLeftSidebarButton) elements.toggleLeftSidebarButton.classList.toggle('is-active', !document.body.classList.contains('layout--left-collapsed'));
  if (elements.toggleRightSidebarButton) elements.toggleRightSidebarButton.classList.toggle('is-active', !document.body.classList.contains('layout--right-collapsed'));
  if (elements.focusModeButton) elements.focusModeButton.classList.toggle('is-active', document.body.classList.contains('layout--focus-stage'));
  if (elements.leftSidebar) elements.leftSidebar.hidden = document.body.classList.contains('layout--left-collapsed') || document.body.classList.contains('layout--focus-stage');
  if (elements.rightSidebar) elements.rightSidebar.hidden = document.body.classList.contains('layout--right-collapsed') || document.body.classList.contains('layout--focus-stage');
}

function syncExportPresetUi({ forceScale = false } = {}) {
  const preset = currentExportPreset();
  if (elements.exportPresetSelect.value !== preset.id) elements.exportPresetSelect.value = preset.id;
  const shouldSyncScale = forceScale;
  const presetScale = Number.parseFloat(String(preset.scale));
  const normalizedScale = presetScale >= 2.5 ? '3' : presetScale >= 1.5 ? '2' : '1';
  if (shouldSyncScale && EXPORT_SCALE_OPTIONS.includes(Number.parseFloat(normalizedScale))) {
    syncMirroredControls(elements.exportScaleSelectControls, normalizedScale);
    markAdvancedSettingsDirty(true);
  }
  if (elements.exportPresetSelect) elements.exportPresetSelect.title = preset.description || '';
  for (const button of elements.downloadPresetButtons) {
    button?.classList.toggle('is-active', (button?.dataset?.downloadPreset || '') === preset.id);
  }
}

function setSelectionMode(nextMode) {
  store.setSelectionMode(nextMode);
  activeEditor?.setSelectionMode(nextMode);
}

function syncViewFeatureButtons() {
  const mapping = [
    ['snap', elements.viewSnapToggleButton, '스냅'],
    ['snap', elements.settingsSnapToggleButton, '스냅'],
    ['guide', elements.viewGuideToggleButton, '가이드'],
    ['guide', elements.settingsGuideToggleButton, '가이드'],
    ['ruler', elements.viewRulerToggleButton, '눈금자'],
    ['ruler', elements.settingsRulerToggleButton, '눈금자'],
  ];
  for (const [key, button, label] of mapping) {
    if (!button) continue;
    const isOn = !!viewFeatureFlags[key];
    button.classList.toggle('is-active', isOn);
    button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    button.textContent = `${label}: ${isOn ? 'ON' : 'OFF'}`;
  }
  if (elements.settingsBeginnerModeButton) {
    elements.settingsBeginnerModeButton.classList.toggle('is-active', !!isBeginnerMode);
    elements.settingsBeginnerModeButton.textContent = `초보 모드: ${isBeginnerMode ? 'ON' : 'OFF'}`;
  }
}

function toggleViewFeatureFlag(key, label) {
  if (!(key in viewFeatureFlags)) return;
  viewFeatureFlags[key] = !viewFeatureFlags[key];
  syncViewFeatureButtons();
  setStatus(`${label} 표시를 ${viewFeatureFlags[key] ? '켰습니다' : '껐습니다'} (기능 플래그 유지)`);
}

function renderSelectionModeButtons(currentMode) {
  for (const button of elements.selectionModeButtons) {
    button.classList.toggle('is-active', button.dataset.selectionMode === currentMode);
  }
}

function syncTextAlignSelect(currentAlign, enabled) {
  if (!elements.textAlignSelect) return;
  elements.textAlignSelect.disabled = !enabled;
  elements.textAlignSelect.value = enabled && currentAlign ? currentAlign : '';
}

function readAutosavePayload() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistAutosave(snapshot) {
  const project = store.getState().project;
  if (!project || !snapshot) return;
  const payload = {
    savedAt: new Date().toISOString(),
    sourceName: project.sourceName,
    sourceType: project.sourceType,
    fixtureId: project.fixtureId || '',
    snapshot,
  };
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {}
}

function resolveSnapshotProjectKey(project) {
  if (!project) return '';
  return [project.fixtureId || '', project.sourceType || '', project.sourceName || ''].join('::');
}

function readProjectSnapshotPayload() {
  try {
    const raw = localStorage.getItem(PROJECT_SNAPSHOT_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.entries)) return { entries: [] };
    return { entries: parsed.entries.filter((entry) => entry?.snapshot?.html) };
  } catch {
    return { entries: [] };
  }
}

function writeProjectSnapshotPayload(payload) {
  try {
    localStorage.setItem(PROJECT_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {}
}

function buildSnapshotThumbnail(snapshotHtml = '') {
  try {
    const doc = new DOMParser().parseFromString(snapshotHtml, 'text/html');
    const img = doc.querySelector('img[src]');
    const rawSrc = String(img?.getAttribute('src') || '').trim();
    const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return {
      imageSrc: resolveRuntimeAssetPreviewUrl(rawSrc) || rawSrc,
      text: text || '텍스트 미리보기가 없습니다.',
    };
  } catch {
    return { imageSrc: '', text: '미리보기를 읽을 수 없습니다.' };
  }
}

function getSnapshotEntriesForProject(project) {
  const key = resolveSnapshotProjectKey(project);
  if (!key) return [];
  return readProjectSnapshotPayload().entries.filter((entry) => entry.projectKey === key);
}

function createProjectSnapshot({
  title = '',
  note = '',
  auto = false,
  statusMessage = '스냅샷을 저장했습니다.',
} = {}) {
  const project = store.getState().project;
  if (!project || !activeEditor) {
    setStatus('먼저 프로젝트를 불러와 주세요.');
    return null;
  }
  const snapshot = activeEditor.captureSnapshot(auto ? 'snapshot-auto' : 'snapshot-manual');
  if (!snapshot?.html) {
    setStatus('스냅샷 저장에 실패했습니다. 다시 시도해 주세요.');
    return null;
  }
  const now = new Date();
  const thumbnail = buildSnapshotThumbnail(snapshot.html);
  const entry = {
    id: `snap_${Math.random().toString(36).slice(2, 10)}`,
    projectKey: resolveSnapshotProjectKey(project),
    sourceName: project.sourceName || '',
    createdAt: now.toISOString(),
    title: (title || '').trim() || (auto ? `자동백업 ${now.toLocaleString()}` : `수동 스냅샷 ${now.toLocaleString()}`),
    note: (note || '').trim(),
    auto: !!auto,
    thumbnail,
    snapshot,
  };
  const payload = readProjectSnapshotPayload();
  payload.entries = [entry, ...payload.entries].slice(0, PROJECT_SNAPSHOT_LIMIT);
  writeProjectSnapshotPayload(payload);
  renderProjectSnapshotList(store.getState());
  setStatus(statusMessage);
  return entry;
}

async function restoreProjectSnapshotById(snapshotId) {
  const state = store.getState();
  const project = state.project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const entry = getSnapshotEntriesForProject(project).find((item) => item.id === snapshotId);
  if (!entry?.snapshot?.html) return setStatus('복원할 스냅샷을 찾지 못했습니다.');
  await ensureRuntimeAssetRecords(entry.snapshot.runtimeAssetIds || []);
  createProjectSnapshot({
    auto: true,
    title: `복원 전 자동백업 (${entry.title || '스냅샷'})`,
    statusMessage: '복원 전 자동백업을 저장했습니다.',
  });
  mountProject(project, { snapshot: entry.snapshot, preserveHistory: false, force: true });
  setStatus(`스냅샷 "${entry.title || '이름 없음'}" 상태로 복원했습니다.`);
}

function deleteProjectSnapshotById(snapshotId) {
  const payload = readProjectSnapshotPayload();
  const nextEntries = payload.entries.filter((entry) => entry.id !== snapshotId);
  if (nextEntries.length === payload.entries.length) return;
  payload.entries = nextEntries;
  writeProjectSnapshotPayload(payload);
  renderProjectSnapshotList(store.getState());
  setStatus('스냅샷을 삭제했습니다.');
}

function refreshHistoryButtons() {
  const hasProject = !!store.getState().project;
  if (elements.undoButton) elements.undoButton.disabled = !hasProject || historyState.undoStack.length === 0;
  if (elements.redoButton) elements.redoButton.disabled = !hasProject || historyState.redoStack.length === 0;
  if (elements.restoreAutosaveButton) elements.restoreAutosaveButton.disabled = !readAutosavePayload();
  refreshLauncherRecentButton();
}

function resetHistory(baseSnapshot = null) {
  historyState.baseSnapshot = baseSnapshot?.html ? baseSnapshot : null;
  historyState.undoStack = [];
  historyState.redoStack = [];
  refreshHistoryButtons();
}

function latestHistorySnapshot() {
  return historyState.undoStack.at(-1)?.after || historyState.baseSnapshot;
}

function shouldMergeHistoryCommand(previous, next) {
  if (!previous || !next) return false;
  if (previous.label !== next.label) return false;
  if (!LIVE_HISTORY_LABELS.has(next.label)) return false;
  const prevAt = new Date(previous.at || 0).getTime();
  const nextAt = new Date(next.at || 0).getTime();
  if (!Number.isFinite(prevAt) || !Number.isFinite(nextAt)) return false;
  return Math.max(0, nextAt - prevAt) <= HISTORY_MERGE_WINDOW_MS;
}

function recordHistoryCommand(command, { clearRedo = true } = {}) {
  if (!command?.after?.html || !command?.before?.html) return;
  const last = historyState.undoStack.at(-1);
  if (shouldMergeHistoryCommand(last, command)) {
    last.after = command.after;
    last.at = command.at;
    persistAutosave(command.after);
    refreshHistoryButtons();
    return;
  }
  if (last?.after?.html === command.after.html) {
    persistAutosave(command.after);
    refreshHistoryButtons();
    return;
  }
  historyState.undoStack.push(command);
  if (historyState.undoStack.length > HISTORY_LIMIT) historyState.undoStack.shift();
  if (clearRedo) historyState.redoStack = [];
  persistAutosave(command.after);
  refreshHistoryButtons();
}

function restoreHistorySnapshot(snapshot, label) {
  const project = store.getState().project;
  if (!project || !snapshot) return;
  mountProject(project, { snapshot, preserveHistory: true, force: true });
  setStatus(label);
}

function undoHistory() {
  if (!historyState.undoStack.length) {
    setStatus('되돌릴 작업이 없습니다.');
    return;
  }
  const current = historyState.undoStack.pop();
  historyState.redoStack.push(current);
  refreshHistoryButtons();
  restoreHistorySnapshot(current.before, '이전 작업으로 되돌렸습니다.');
}

function redoHistory() {
  if (!historyState.redoStack.length) {
    setStatus('다시 적용할 작업이 없습니다.');
    return;
  }
  const next = historyState.redoStack.pop();
  historyState.undoStack.push(next);
  refreshHistoryButtons();
  restoreHistorySnapshot(next.after, '되돌린 작업을 다시 적용했습니다.');
}

function buildReportPayload(project, report) {
  return {
    project: {
      id: project.id,
      fixtureId: project.fixtureId,
      sourceName: project.sourceName,
      sourceType: project.sourceType,
    },
    report,
    history: {
      undoDepth: historyState.undoStack.length,
      redoDepth: historyState.redoStack.length,
      autosaveSavedAt: readAutosavePayload()?.savedAt || '',
    },
    summary: project.summary,
    issues: project.issues,
    assets: project.assets,
    preflight: report.preflight || null,
    save: {
      selectedFormat: currentSaveFormat,
      lastConversion: lastSaveConversion,
    },
  };
}

function getEditorReport(project) {
  if (activeEditor) return activeEditor.getReport();
  return {
    sourceName: project.sourceName,
    sourceType: project.sourceType,
    slotSummary: project.slotDetection?.summary || project.summary,
    slots: project.slotDetection?.candidates || [],
    sections: [],
    selectedSectionUid: '',
    nearMisses: project.slotDetection?.nearMisses || [],
    modifiedSlotCount: 0,
    layerTree: [],
    selectedItems: [],
    selectionCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

function refreshComputedViews(state) {
  const project = state.project;
  if (elements.normalizedCodeView) elements.normalizedCodeView.textContent = project?.normalizedHtml || '';
  if (elements.originalCodeView) elements.originalCodeView.textContent = project?.originalHtml || '';

  if (!project) {
    if (elements.editedCodeView) elements.editedCodeView.textContent = '';
    if (elements.jsonReportView) elements.jsonReportView.textContent = '';
    refreshCodeEditorFromState({ force: true });
    return;
  }

  const editedHtml = activeEditor ? activeEditor.getEditedHtml({ persistDetectedSlots: true }) : project.normalizedHtml;
  if (elements.editedCodeView) elements.editedCodeView.textContent = editedHtml;
  const report = getEditorReport(project);
  if (elements.jsonReportView) elements.jsonReportView.textContent = JSON.stringify(buildReportPayload(project, report), null, 2);
  refreshCodeEditorFromState();
}

function syncTextStyleControls(editorMeta) {
  const style = editorMeta?.textStyle || null;
  const enabled = !!style?.enabled;
  const inputs = [
    elements.textFontSizeInput,
    elements.textLineHeightInput,
    elements.textLetterSpacingInput,
    elements.textWeightSelect,
    elements.textColorInput,
    elements.applyTextStyleButton,
    elements.clearTextStyleButton,
  ];
  for (const input of inputs) {
    if (!input) continue;
    input.disabled = !enabled;
  }
  syncTextAlignSelect(style?.textAlign || '', enabled);
  elements.textStyleSummary.textContent = enabled
    ? `텍스트 ${style.targetCount || 1}개 선택`
    : '텍스트 미선택';

  elements.textFontSizeInput.value = enabled && style.fontSize ? String(style.fontSize) : '';
  elements.textLineHeightInput.value = enabled && style.lineHeight ? String(style.lineHeight) : '';
  elements.textLetterSpacingInput.value = enabled && style.letterSpacing ? String(style.letterSpacing) : '';
  elements.textWeightSelect.value = enabled && style.fontWeight ? String(style.fontWeight) : '';
  elements.textColorInput.value = enabled && style.color ? style.color : '#333333';
}

function syncBatchSummary(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  elements.batchSelectionSummary.textContent = count > 1 ? `${count}개 동시 선택` : '1개 이하 선택';
}

function resolvePrimarySelectionType(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  if (count !== 1) return '';
  const selectedType = editorMeta?.selectedItems?.[0]?.type || editorMeta?.selected?.type || '';
  if (selectedType === 'slot') return 'image';
  if (selectedType === 'text') return 'text';
  if (selectedType === 'box') return 'box';
  return '';
}

function syncRightPanelBySelection(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  const hasSelection = count > 0;
  if (elements.selectionEmptyState) elements.selectionEmptyState.hidden = hasSelection;
  const type = hasSelection ? resolvePrimarySelectionType(editorMeta) : '';

  if (elements.inspectorContextBadge) {
    const label = !hasSelection
      ? '선택 없음'
      : (count > 1 ? `다중 선택 ${count}개` : (type === 'text' ? '텍스트' : (type === 'image' ? '이미지/슬롯' : '박스/배치')));
    elements.inspectorContextBadge.textContent = label;
  }

  renderSelectionContextCard(editorMeta);
  if (elements.leftInspectorInspectSection) elements.leftInspectorInspectSection.hidden = false;
  if (elements.leftInspectorTextSection) elements.leftInspectorTextSection.hidden = !(hasSelection && type === 'text');
  if (elements.leftInspectorArrangeSection) elements.leftInspectorArrangeSection.hidden = !hasSelection;
  syncImageInspector(editorMeta);
  syncMultiArrangeTools(editorMeta);

  if (!hasSelection) {
    if (elements.basicAttributeSection) elements.basicAttributeSection.open = false;
    if (elements.advancedAttributeSection) elements.advancedAttributeSection.open = false;
    return;
  }

  if (elements.basicAttributeSection) elements.basicAttributeSection.open = true;
  if (elements.advancedAttributeSection) {
    elements.advancedAttributeSection.open = type === 'image' || count > 1;
  }

  const activeLeftTab = elements.sidebarTabButtons.find((button) => button.classList.contains('is-active') && String(button.dataset.sidebarTab || '').startsWith('left-'))?.dataset.sidebarTab || '';
  if (!['left-layers', 'left-export', 'left-diagnostics'].includes(activeLeftTab)) {
    setSidebarTab('left-properties', { syncWorkflow: false });
  }
}


function syncGeometryControls() {
  const geometry = activeEditor?.getSelectionGeometry?.() || null;
  const enabled = !!geometry;
  const controls = [
    elements.geometryCoordModeSelect,
    elements.geometryXInput,
    elements.geometryYInput,
    elements.geometryWInput,
    elements.geometryHInput,
    elements.applyGeometryButton,
    elements.bringForwardButton,
    elements.sendBackwardButton,
    elements.bringToFrontButton,
    elements.sendToBackButton,
    elements.imageNudgeLeftButton,
    elements.imageNudgeRightButton,
    elements.imageNudgeUpButton,
    elements.imageNudgeDownButton,
  ];
  for (const control of controls) {
    if (!control) continue;
    control.disabled = !enabled;
  }
  if (!enabled) {
    for (const input of [elements.geometryXInput, elements.geometryYInput, elements.geometryWInput, elements.geometryHInput]) {
      if (!input) continue;
      input.value = '';
      input.placeholder = '';
      input.dataset.mixed = '0';
    }
    if (elements.geometryRuleHint) elements.geometryRuleHint.textContent = '요소를 선택하면 좌표/크기를 표시합니다.';
    return;
  }
  const mode = geometryCoordMode === 'absolute' ? 'absolute' : 'relative';
  const group = geometry[mode] || geometry.relative;
  const mapping = [
    [elements.geometryXInput, 'x'],
    [elements.geometryYInput, 'y'],
    [elements.geometryWInput, 'w'],
    [elements.geometryHInput, 'h'],
  ];
  for (const [input, key] of mapping) {
    if (!input) continue;
    const mixed = !!group?.mixed?.[key];
    input.dataset.mixed = mixed ? '1' : '0';
    input.placeholder = mixed ? '혼합' : '';
    input.value = mixed ? '' : String(group?.[key] ?? '');
  }
  const modeText = mode === 'absolute'
    ? '절대 좌표: 문서의 왼쪽/위(0,0) 기준'
    : '상대 좌표: 각 요소의 transform 이동값 기준';
  if (elements.geometryRuleHint) {
    elements.geometryRuleHint.textContent = `${modeText} · Shift=10px, Alt=1px, 기본=2px`;
  }
}

function resolveCanvasContextScope(editorMeta) {
  if (editorMeta?.cropActive) return 'crop';
  const count = Number(editorMeta?.selectionCount || 0);
  if (count > 1) return 'multi';
  if (count < 1) return '';
  const selectedType = editorMeta?.selectedItems?.[0]?.type || editorMeta?.selected?.type || '';
  if (selectedType === 'slot') return 'image';
  if (selectedType === 'text') return 'text';
  return '';
}

function configureCanvasQuickbarButtons(scope) {
  const primary = elements.canvasQuickbarPrimary;
  const secondary = elements.canvasQuickbarSecondary;
  if (!primary || !secondary) return;
  const config = scope === 'image'
    ? { primary: ['image-replace', '교체'], secondary: ['image-crop-enter', '크롭'] }
    : scope === 'text'
      ? { primary: ['toggle-text-edit', '텍스트'], secondary: ['open-properties-panel', '속성'] }
      : scope === 'multi'
        ? { primary: ['align-left', '정렬'], secondary: ['distribute-horizontal', '간격'] }
        : { primary: ['open-properties-panel', '속성'], secondary: ['layer-index-forward', '앞으로'] };
  primary.dataset.canvasAction = config.primary[0];
  primary.textContent = config.primary[1];
  secondary.dataset.canvasAction = config.secondary[0];
  secondary.textContent = config.secondary[1];
  primary.hidden = false;
  secondary.hidden = false;
  primary.disabled = !activeEditor;
  secondary.disabled = !activeEditor;
}

function executeCanvasContextAction(action) {
  if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  if (action === 'duplicate' || action === 'delete') return executeEditorCommand(action);
  if (action === 'layer-index-forward') return executeEditorCommand('layer-index-forward');
  if (action === 'layer-index-backward') return executeEditorCommand('layer-index-backward');
  if (action === 'layer-index-front') return executeEditorCommand('layer-index-front');
  if (action === 'layer-index-back') return executeEditorCommand('layer-index-back');
  if (action === 'toggle-text-edit') return executeEditorCommand('toggle-text-edit');
  if (action === 'image-replace') { elements.replaceImageButton?.click(); return { ok: true, message: '이미지 교체 파일 선택기를 열었습니다.' }; }
  if (action === 'open-properties-panel') { setSidebarTab('left-properties'); document.body.classList.remove('layout--left-collapsed'); syncWorkspaceButtons(); applyPreviewZoom(); return { ok: true, message: '속성 패널을 열었습니다.' }; }
  if (action === 'image-crop-enter') return executeEditorCommand('image-crop-enter');
  if (action === 'image-crop-apply') return executeEditorCommand('image-crop-apply');
  if (action === 'image-crop-cancel') return executeEditorCommand('image-crop-cancel');
  if (action === 'image-crop-reset') return executeEditorCommand('image-crop-reset');
  if (action === 'toggle-image-lock') return executeEditorCommand('toggle-image-lock');
  if (action === 'image-cover') return activeEditor.applyImagePreset('cover');
  if (action === 'image-contain') return activeEditor.applyImagePreset('contain');
  if (action === 'image-nudge-left') return activeEditor.nudgeSelectedImage({ dx: -2, dy: 0 });
  if (action === 'image-nudge-right') return activeEditor.nudgeSelectedImage({ dx: 2, dy: 0 });
  if (action === 'image-nudge-up') return activeEditor.nudgeSelectedImage({ dx: 0, dy: -2 });
  if (action === 'image-nudge-down') return activeEditor.nudgeSelectedImage({ dx: 0, dy: 2 });
  if ([
    'same-width',
    'same-height',
    'same-size',
    'align-left',
    'align-center',
    'align-right',
    'align-top',
    'align-middle',
    'align-bottom',
    'distribute-horizontal',
    'distribute-vertical',
  ].includes(action)) return activeEditor.applyBatchLayout(action);
  return { ok: false, message: `지원하지 않는 명령입니다: ${action}` };
}

function syncCanvasDirectUi(editorMeta) {
  const selectionCount = Number(editorMeta?.selectionCount || 0);
  const hasSelection = selectionCount > 0;
  const cropActive = !!editorMeta?.cropActive;
  if (elements.canvasContextBar) {
    elements.canvasContextBar.hidden = !hasSelection || cropActive;
    elements.canvasContextBar.dataset.scope = cropActive ? 'crop' : '';
  }
  if (!hasSelection || cropActive) {
    if (elements.canvasQuickbarMore) {
      elements.canvasQuickbarMore.hidden = true;
      elements.canvasQuickbarMore.removeAttribute('open');
    }
    return;
  }

  const scope = resolveCanvasContextScope(editorMeta);
  configureCanvasQuickbarButtons(scope);
  const overflowButtons = Array.from(elements.canvasQuickbarMore?.querySelectorAll?.('[data-canvas-action]') || []);
  for (const button of elements.canvasActionButtons) {
    const buttonScope = button.dataset.canvasScope || 'common';
    const isDynamicContext = button === elements.canvasQuickbarPrimary || button === elements.canvasQuickbarSecondary;
    const visible = isDynamicContext ? true : (buttonScope === 'common' || (scope && buttonScope === scope));
    button.hidden = !visible;
    button.disabled = !visible || !activeEditor;
  }
  if (elements.canvasQuickbarMore) {
    const visibleOverflow = overflowButtons.some((button) => !button.hidden);
    elements.canvasQuickbarMore.hidden = !visibleOverflow;
    if (!visibleOverflow) elements.canvasQuickbarMore.removeAttribute('open');
  }

  const geometryEnabled = !!activeEditor?.getSelectionGeometry?.();
  const mirrorPairs = [
    [elements.canvasGeometryXInput, elements.geometryXInput],
    [elements.canvasGeometryYInput, elements.geometryYInput],
    [elements.canvasGeometryWInput, elements.geometryWInput],
    [elements.canvasGeometryHInput, elements.geometryHInput],
  ];
  for (const [canvasInput, sourceInput] of mirrorPairs) {
    if (!canvasInput || !sourceInput) continue;
    canvasInput.value = sourceInput.value;
    canvasInput.placeholder = sourceInput.placeholder || '';
    canvasInput.dataset.mixed = sourceInput.dataset.mixed || '0';
    canvasInput.disabled = !geometryEnabled;
  }
  if (elements.applyCanvasGeometryButton) elements.applyCanvasGeometryButton.disabled = !geometryEnabled;
}

function syncImageLockControls(editorMeta) {
  const selectionType = editorMeta?.selectedItems?.[0]?.type || editorMeta?.selected?.type || '';
  const enabled = selectionType === 'slot' && Number(editorMeta?.selectionCount || 0) === 1;
  const locked = !!editorMeta?.selected?.imageLocked;
  if (elements.toggleImageLockButton) {
    elements.toggleImageLockButton.disabled = !enabled;
    elements.toggleImageLockButton.classList.toggle('is-active', enabled && locked);
    elements.toggleImageLockButton.textContent = enabled ? (locked ? '이미지 잠금 해제' : '이미지 잠금') : '이미지 잠금';
  }
  for (const button of elements.canvasActionButtons.filter((node) => node.dataset.canvasAction === 'toggle-image-lock')) {
    button.classList.toggle('is-active', enabled && locked);
    button.textContent = enabled ? (locked ? '잠금 해제' : '이미지 잠금') : '이미지 잠금';
  }
}

function applyGeometryFromInputs() {
  if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  const values = {
    x: Number.parseFloat(elements.geometryXInput.value),
    y: Number.parseFloat(elements.geometryYInput.value),
    w: Number.parseFloat(elements.geometryWInput.value),
    h: Number.parseFloat(elements.geometryHInput.value),
  };
  const patch = {};
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) continue;
    patch[key] = value;
  }
  if (!Object.keys(patch).length) return { ok: false, message: '적용할 숫자 값을 입력해 주세요.' };
  return activeEditor.applyGeometryPatch(patch, { coordinateSpace: geometryCoordMode });
}

function moveNodeIntoMount(nodeOrSelector, mount) {
  if (!mount) return;
  const node = typeof nodeOrSelector === 'string'
    ? document.getElementById(nodeOrSelector) || document.querySelector(nodeOrSelector)
    : nodeOrSelector;
  if (!node || node.parentElement === mount) return;
  mount.appendChild(node);
}

function ensureThemeStudioLayout() {
  if (themeStudioMounted) return;
  if (!elements.themeStudioColorsMount || !elements.themeStudioTokensMount || !elements.themeStudioLintMount || !elements.themeStudioApplyMount) return;
  moveNodeIntoMount('styleColorStudioSection', elements.themeStudioColorsMount);
  moveNodeIntoMount('sectionThemePaletteSection', elements.themeStudioColorsMount);
  moveNodeIntoMount('cssTokenEditorSection', elements.themeStudioTokensMount);
  moveNodeIntoMount('styleTokenEditorSection', elements.themeStudioTokensMount);
  moveNodeIntoMount('inlineColorExtractSection', elements.themeStudioTokensMount);
  moveNodeIntoMount('slotSchemaSection', elements.themeStudioTokensMount);
  moveNodeIntoMount('assetRelinkSection', elements.themeStudioLintMount);
  moveNodeIntoMount('marketLintSection', elements.themeStudioLintMount);
  moveNodeIntoMount('contrastLintSection', elements.themeStudioLintMount);
  moveNodeIntoMount(document.querySelector('.html-flow-card'), elements.themeStudioApplyMount);
  themeStudioMounted = true;
}

function setThemeStudioMode(mode = 'colors') {
  const normalized = ['colors', 'tokens', 'lint', 'apply'].includes(String(mode)) ? String(mode) : 'colors';
  themeStudioMode = normalized;
  for (const button of elements.themeStudioModeButtons || []) {
    button.classList.toggle('is-active', button.dataset.themeStudioMode === normalized);
  }
  document.querySelectorAll('[data-theme-studio-pane]').forEach((pane) => {
    const active = pane.getAttribute('data-theme-studio-pane') === normalized;
    pane.hidden = !active;
    pane.classList.toggle('is-active', active);
  });
  syncThemeStudioHub(store.getState());
}

function refreshThemeStudioCurrentPane() {
  const state = store.getState();
  if (themeStudioMode === 'colors') {
    renderStyleColorStudio(state);
    renderSectionThemePalettes(state);
  } else if (themeStudioMode === 'tokens') {
    renderCssTokenEditor(state);
    renderDesignTokenEditor(state);
    renderInlineColorExtractPanel(state);
  } else if (themeStudioMode === 'lint') {
    renderBrokenAssetPanel(state.project);
    renderLintIssues(elements.marketLintList, buildMarketUploadLint(getBestEditedHtml(state), state.project, state.editorMeta));
    renderContrastLintPanel(state);
  } else if (themeStudioMode === 'apply') {
    syncCodeWorkbenchState({ announce: false });
  }
  syncThemeStudioHub(state);
}

function syncThemeStudioHub(state = store.getState()) {
  ensureThemeStudioLayout();
  const unresolvedCount = buildUnresolvedAssetItems(state.project).length;
  const selectedSectionUid = getSelectedSectionUidForColorScope(state);
  const selectedSectionPalette = lastSectionThemePalettes.find((item) => item.uid === selectedSectionUid) || null;
  if (elements.themeStudioBadge) {
    elements.themeStudioBadge.textContent = `색상 ${lastStyleColorPalette.length} · 토큰 ${lastCssTokenPalette.length + lastDesignTokenPalette.length} · 검사 ${lastMarketLintIssues.length + lastContrastLintIssues.length + unresolvedCount}`;
  }
  if (elements.themeStudioSummary) {
    if (themeStudioMode === 'colors') {
      elements.themeStudioSummary.textContent = selectedSectionPalette
        ? `문서 색상 ${lastStyleColorPalette.length}개 · 선택 섹션 팔레트 ${selectedSectionPalette.colors.length}개를 바로 바꿀 수 있습니다.`
        : `문서 색상 ${lastStyleColorPalette.length}개 · 섹션 팔레트 ${lastSectionThemePalettes.length}개를 읽었습니다.`;
    } else if (themeStudioMode === 'tokens') {
      elements.themeStudioSummary.textContent = `컬러 토큰 ${lastCssTokenPalette.length}개 · 디자인 토큰 ${lastDesignTokenPalette.length}개 · inline 추출 후보 ${lastInlineColorExtractCandidates.length}개`;
    } else if (themeStudioMode === 'lint') {
      elements.themeStudioSummary.textContent = `마켓 lint ${lastMarketLintIssues.length}개 · 대비 lint ${lastContrastLintIssues.length}개 · 미해결 자산 ${unresolvedCount}개`;
    } else {
      const sourceLabel = getCodeSourceLabel('current-source');
      const dirtyText = codeEditorDirty ? ' · 초안 변경 있음' : ' · 동기화 상태';
      elements.themeStudioSummary.textContent = `현재 보기 ${sourceLabel}${dirtyText}`;
    }
  }
  if (elements.themeStudioFlowState) {
    elements.themeStudioFlowState.textContent = lastAppliedCodeImpact
      ? `마지막 적용(${lastAppliedCodeImpact.mergeMode || 'full'}) · 섹션 ${lastAppliedCodeImpact.sectionDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.sectionDelta}, 슬롯 ${lastAppliedCodeImpact.slotDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.slotDelta}, 자산 ${lastAppliedCodeImpact.assetDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.assetDelta}`
      : '코드 적용 영향이 아직 없습니다.';
  }
  if (elements.themeStudioApplyHint) {
    elements.themeStudioApplyHint.textContent = codeEditorDirty
      ? '코드 초안에 변경이 있습니다. 안전 적용으로 병합할 수 있습니다.'
      : '코드 패널과 현재 캔버스가 동기화되어 있습니다.';
  }
  if (elements.themeStudioComparePresetSelect && elements.codeComparePresetSelect) {
    elements.themeStudioComparePresetSelect.value = elements.codeComparePresetSelect.value || 'edited-vs-original';
  }
  if (elements.themeStudioCompareSummary) {
    elements.themeStudioCompareSummary.textContent = `${lastCodeCompareResult.baseLabel} ↔ ${lastCodeCompareResult.targetLabel} · chunk ${lastCodeCompareResult.chunkCount}개 · 변경 ${lastCodeDiffSummary.changedLines}줄`;
  }
  if (elements.themeStudioIssuesOnlyButton) {
    elements.themeStudioIssuesOnlyButton.classList.toggle('is-active', !!codeCompareIssuesOnly);
    elements.themeStudioIssuesOnlyButton.textContent = codeCompareIssuesOnly ? '이슈 연결만 ON' : '이슈 연결만';
  }
  if (elements.themeStudioColorDiffButton) {
    elements.themeStudioColorDiffButton.classList.toggle('is-active', !!codeCompareColorOnly);
    elements.themeStudioColorDiffButton.textContent = codeCompareColorOnly ? '색상 변경만 ON' : '색상 변경만';
  }
  if (elements.themeStudioSafeApplyButton) elements.themeStudioSafeApplyButton.disabled = !state.project || currentCodeSource === 'report';
  if (elements.themeStudioOpenCodeButton) elements.themeStudioOpenCodeButton.disabled = !state.project;
  if (elements.themeStudioSyncCodeButton) elements.themeStudioSyncCodeButton.disabled = !state.project;
  if (elements.themeStudioApplyCodeButton) elements.themeStudioApplyCodeButton.disabled = !state.project || currentCodeSource === 'report';
}

function renderShell(state) {
  renderSelectionModeButtons(state.selectionMode);
  renderSummaryCards(elements.summaryCards, state.project, state.editorMeta);
  renderIssueList(elements.issueList, state.project);
  if (elements.normalizeStats) {
    renderNormalizeStats(elements.normalizeStats, state.project);
  }
  renderPreflight(elements.preflightContainer, state.editorMeta);
  if (elements.selectionInspector) {
    renderSelectionInspector(elements.selectionInspector, state.editorMeta, state.imageApplyDiagnostic);
  }
  const sectionPanelSelectedUids = getSectionPanelSelection(state.editorMeta);
  renderSectionFilmstrip(elements.sectionList, { ...(state.editorMeta || {}), sectionPanelSelectedUids });
  hydrateSectionFilmstripPreviews();
  renderPreviewMinimap({ ...(state.editorMeta || {}), sectionPanelSelectedUids });
  syncSectionSelectionSummary(state.editorMeta);
  renderSlotList(elements.slotList, state.editorMeta);
  ensureThemeStudioLayout();
  renderStyleColorStudio(state);
  renderCssTokenEditor(state);
  renderDesignTokenEditor(state);
  renderInlineColorExtractPanel(state);
  renderSectionThemePalettes(state);
  renderBrokenAssetPanel(state.project);
  const marketLintIssues = buildMarketUploadLint(getBestEditedHtml(state), state.project, state.editorMeta);
  renderLintIssues(elements.marketLintList, marketLintIssues);
  renderContrastLintPanel(state);
  syncSectionNoteEditor(state);
  renderUploadLists(state);
  renderProjectSnapshotList(state);
  renderLayerTree(elements.layerTree, state.editorMeta, elements.layerFilterInput?.value || '');
  if (elements.topbarDocTitle) elements.topbarDocTitle.textContent = state.project?.sourceName || '문서 없음';
  renderProjectMeta(elements.projectMeta, state.project, {
    selectionMode: state.selectionMode,
    undoDepth: historyState.undoStack.length,
    redoDepth: historyState.redoStack.length,
    autosaveSavedAt: readAutosavePayload()?.savedAt || '',
    textEditing: !!state.editorMeta?.textEditing,
    selectionCount: state.editorMeta?.selectionCount || 0,
    hiddenCount: state.editorMeta?.hiddenCount || 0,
    lockedCount: state.editorMeta?.lockedCount || 0,
    exportPresetLabel: currentExportPreset().label,
    preflightBlockingErrors: state.editorMeta?.preflight?.blockingErrors || 0,
  });
  if (elements.assetTableWrap) {
    renderAssetTable(elements.assetTableWrap, state.project, elements.assetFilterInput?.value || '');
  }
  syncTextStyleControls(state.editorMeta);
  syncBatchSummary(state.editorMeta);
  syncRightPanelBySelection(state.editorMeta);
  syncGeometryControls();
  syncCodeWorkbenchState();
  if (elements.codeApplyImpactSummary) {
    elements.codeApplyImpactSummary.textContent = lastAppliedCodeImpact
      ? `코드 적용 영향(${lastAppliedCodeImpact.mergeMode || 'full'}): 섹션 ${lastAppliedCodeImpact.sectionDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.sectionDelta}, 슬롯 ${lastAppliedCodeImpact.slotDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.slotDelta}, 자산 ${lastAppliedCodeImpact.assetDelta >= 0 ? '+' : ''}${lastAppliedCodeImpact.assetDelta}`
      : '코드 변경 영향 범위가 아직 없습니다.';
  }
  syncImageLockControls(state.editorMeta);
  syncCropHudControls(state.editorMeta);
  syncCanvasDirectUi(state.editorMeta);
  const errorSuffix = state.lastError ? ` · 최근 오류: ${state.lastError}` : '';
  elements.statusText.textContent = `${state.statusText}${errorSuffix}`;
  if (elements.documentStatusChip) {
    const docStatus = resolveDocumentStatus(state);
    elements.documentStatusChip.dataset.status = docStatus.status;
    elements.documentStatusChip.textContent = docStatus.text;
  }
  refreshComputedViews(state);

  const hasProject = !!state.project;
  const hasEditor = !!activeEditor;
  elements.replaceImageButton.disabled = !hasEditor;
  elements.manualSlotButton.disabled = !hasEditor;
  elements.demoteSlotButton.disabled = !hasEditor;
  elements.redetectButton.disabled = !hasEditor;
  elements.toggleHideButton.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < 1;
  elements.toggleLockButton.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < 1;
  if (elements.arrangeToggleHideButton) elements.arrangeToggleHideButton.disabled = elements.toggleHideButton.disabled;
  if (elements.arrangeToggleLockButton) elements.arrangeToggleLockButton.disabled = elements.toggleLockButton.disabled;
  if (elements.textEditButton) elements.textEditButton.disabled = !hasEditor;
  elements.groupButton.disabled = !hasEditor || !state.editorMeta?.canGroupSelection;
  elements.ungroupButton.disabled = !hasEditor || !state.editorMeta?.canUngroupSelection;
  elements.preflightRefreshButton.disabled = !hasEditor;
  if (elements.saveProjectSnapshotButton) elements.saveProjectSnapshotButton.disabled = !hasEditor;
  if (elements.saveSnapshotFromPanelButton) elements.saveSnapshotFromPanelButton.disabled = !hasEditor;
  for (const button of elements.batchActionButtons) {
    const requiresMany = button.dataset.batchAction !== 'reset-transform';
    const needed = requiresMany ? 2 : 1;
    button.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < needed;
  }
  const selectionCount = Number(state.editorMeta?.selectionCount || 0);
  if (elements.batchActionSelect) elements.batchActionSelect.disabled = !hasEditor || selectionCount < 2;
  if (elements.applyBatchActionButton) elements.applyBatchActionButton.disabled = !hasEditor || selectionCount < 2 || !elements.batchActionSelect?.value;
  if (elements.stackApplyButton) elements.stackApplyButton.disabled = !hasEditor || selectionCount < 2;
  if (elements.tidyApplyButton) elements.tidyApplyButton.disabled = !hasEditor || selectionCount < 3;
  if (elements.stackHorizontalButton) elements.stackHorizontalButton.disabled = !hasEditor || selectionCount < 2;
  if (elements.stackVerticalButton) elements.stackVerticalButton.disabled = !hasEditor || selectionCount < 2;
  if (elements.tidyHorizontalButton) elements.tidyHorizontalButton.disabled = !hasEditor || selectionCount < 3;
  if (elements.tidyVerticalButton) elements.tidyVerticalButton.disabled = !hasEditor || selectionCount < 3;
  for (const button of elements.downloadEditedButtons) {
    button.disabled = !hasProject;
  }
  elements.downloadNormalizedButton.disabled = !hasProject;
  elements.downloadLinkedZipButton.disabled = !hasEditor;
  for (const button of elements.exportPngButtons) {
    button.disabled = !hasEditor;
  }
  for (const button of elements.exportJpgButtons) {
    button.disabled = !hasEditor;
  }
  elements.exportSectionsZipButton.disabled = !hasEditor;
  elements.exportSelectionPngButton.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < 1;
  elements.exportPresetPackageButton.disabled = !hasEditor;
  if (elements.sectionDuplicateButton) elements.sectionDuplicateButton.disabled = !hasEditor || !state.editorMeta?.selectedSectionUid;
  if (elements.sectionMoveUpButton) elements.sectionMoveUpButton.disabled = !hasEditor || !state.editorMeta?.selectedSectionUid;
  if (elements.sectionMoveDownButton) elements.sectionMoveDownButton.disabled = !hasEditor || !state.editorMeta?.selectedSectionUid;
  if (elements.sectionDeleteButton) elements.sectionDeleteButton.disabled = !hasEditor || !state.editorMeta?.selectedSectionUid;
  if (elements.sectionAddButton) elements.sectionAddButton.disabled = !hasEditor;
  if (elements.downloadReportButton) elements.downloadReportButton.disabled = !hasProject;
  if (elements.applyCodeToEditorButton) elements.applyCodeToEditorButton.disabled = !hasProject || currentCodeSource === 'report';
  if (elements.safeApplyCodeButton) elements.safeApplyCodeButton.disabled = !hasProject || currentCodeSource === 'report';
  if (elements.generateSlotSchemaButton) elements.generateSlotSchemaButton.disabled = !hasEditor || !(state.editorMeta?.slotSummary?.totalCount > 0);
  if (elements.relinkBrokenAssetsButton) elements.relinkBrokenAssetsButton.disabled = !hasProject || !buildUnresolvedAssetItems(state.project).length;
  if (elements.refreshBrokenAssetsButton) elements.refreshBrokenAssetsButton.disabled = !hasProject;
  if (elements.reloadCodeFromEditorButton) elements.reloadCodeFromEditorButton.disabled = !hasProject;
  if (elements.saveFormatSelect) elements.saveFormatSelect.disabled = !hasProject;
  if (elements.applyAdvancedSettingsButton) elements.applyAdvancedSettingsButton.disabled = !hasProject;
  syncExportPresetUi();
  syncSaveFormatUi();
  syncDownloadDensityUi();
  syncWorkspaceButtons();
  syncWorkflowGuide(state);
  syncThemeStudioHub(state);
  applyPreviewZoom();
  refreshHistoryButtons();
}

function renderEmptyPreview() {
  elements.previewFrame.srcdoc = `
    <div class="empty-stage">
      <div>
        <strong>아직 프로젝트가 없습니다.</strong><br />
        HTML 파일, 프로젝트 폴더, 붙여넣기, fixture 중 하나를 불러와 주세요.
      </div>
    </div>`;
}

function applyNumberStep(input, direction) {
  if (!input || input.disabled) return;
  try {
    if (direction > 0) input.stepUp();
    else input.stepDown();
  } catch {
    const stepRaw = Number.parseFloat(input.step);
    const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
    const current = Number.parseFloat(input.value);
    const base = Number.isFinite(current) ? current : 0;
    input.value = String(base + (direction > 0 ? step : -step));
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function attachNumberStepper(input) {
  if (!input || input.dataset.stepperReady === '1') return;
  const wrapper = document.createElement('div');
  wrapper.className = 'number-stepper';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const buttonWrap = document.createElement('div');
  buttonWrap.className = 'number-stepper__buttons';
  const plusButton = document.createElement('button');
  plusButton.type = 'button';
  plusButton.className = 'number-stepper__btn';
  plusButton.textContent = '+';
  plusButton.title = '값 증가';
  const minusButton = document.createElement('button');
  minusButton.type = 'button';
  minusButton.className = 'number-stepper__btn';
  minusButton.textContent = '−';
  minusButton.title = '값 감소';

  plusButton.addEventListener('click', () => applyNumberStep(input, 1));
  minusButton.addEventListener('click', () => applyNumberStep(input, -1));
  buttonWrap.append(plusButton, minusButton);
  wrapper.append(buttonWrap);

  input.dataset.stepperReady = '1';
}

function initNumericSteppers() {
  const targets = [
    elements.textFontSizeInput,
    elements.textLineHeightInput,
    elements.textLetterSpacingInput,
    elements.geometryXInput,
    elements.geometryYInput,
    elements.geometryWInput,
    elements.geometryHInput,
    elements.canvasGeometryXInput,
    elements.canvasGeometryYInput,
    elements.canvasGeometryWInput,
    elements.canvasGeometryHInput,
  ];
  for (const input of targets) attachNumberStepper(input);
}

function handleEditorShortcut(action) {
  if (action === 'undo') return undoHistory();
  if (action === 'redo') return redoHistory();
  if (action === 'save-edited') return downloadEditedHtml().catch((error) => setStatus(`문서 저장 중 오류: ${error?.message || error}`));
  if (action === 'toggle-shortcut-help') return toggleShortcutHelp();
  if (action === 'preview-fit') return setZoom('fit');
  if (action === 'preview-space-pan-arm') {
    previewSpacePanArmed = true;
    elements.previewViewport?.classList.add('is-space-pan');
    return;
  }
  if (action === 'preview-space-pan-disarm') {
    previewSpacePanArmed = false;
    elements.previewViewport?.classList.remove('is-space-pan');
    return;
  }
  if (action === 'section-jump-prev') return jumpSectionByOffset(-1);
  if (action === 'section-jump-next') return jumpSectionByOffset(1);
}

function executeEditorCommand(command, payload = {}, { refresh = true } = {}) {
  if (!activeEditor) {
    setStatus('먼저 미리보기를 로드해 주세요.');
    return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  }
  const result = activeEditor.executeCommand ? activeEditor.executeCommand(command, payload) : { ok: false, message: `지원하지 않는 명령입니다: ${command}` };
  setStatus(result.message);
  if (refresh && (store.getState().currentView === 'edited' || store.getState().currentView === 'report')) refreshComputedViews(store.getState());
  return result;
}

function mountProject(project, { snapshot = null, preserveHistory = false, force = false } = {}) {
  teardownPreviewFrameBindings();
  if (activeEditor) {
    try { activeEditor.destroy(); } catch {}
    activeEditor = null;
  }

  if (force) mountedProjectId = '';
  mountedProjectId = project?.id || '';
  if (!project) {
    renderEmptyPreview();
    store.setEditorMeta(null);
    teardownPreviewFrameBindings();
    return;
  }

  elements.previewFrame.onload = () => {
    const liveProject = store.getState().project;
    if (!liveProject || liveProject.id !== project.id) return;
    activeEditor = createFrameEditor({
      iframe: elements.previewFrame,
      project,
      selectionMode: snapshot?.selectionMode || store.getState().selectionMode,
      initialSnapshot: snapshot,
      onStateChange: (meta) => store.setEditorMeta(meta),
      onStatus: setStatus,
      onMutation: (command) => {
        recordHistoryCommand(command);
        if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
      },
      onShortcut: handleEditorShortcut,
    });
    if (snapshot?.selectionMode) store.setSelectionMode(snapshot.selectionMode);
    store.setEditorMeta(activeEditor.getMeta());
    bindPreviewFrameInteractions();
    applyPreviewZoom();
    if (!preserveHistory) {
      resetHistory(activeEditor.captureSnapshot('initial'));
      persistAutosave(historyState.baseSnapshot);
      refreshHistoryButtons();
    } else {
      persistAutosave(latestHistorySnapshot() || activeEditor.captureSnapshot('restore'));
      refreshHistoryButtons();
    }
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  };
  elements.previewFrame.srcdoc = snapshot?.html || project.normalizedHtml;
}

function loadFixture(fixtureId) {
  try {
    const fixtureMeta = getFixtureMeta(fixtureId);
    const html = FIXTURE_SOURCE_MAP[fixtureId] || '';
    if (!fixtureMeta || !html) {
      setStatus(`Fixture ${fixtureId}를 찾지 못했습니다.`);
      return;
    }
    pendingMountOptions = { snapshot: null, preserveHistory: false };
    const project = normalizeProject({ html, sourceName: fixtureMeta.name, sourceType: 'fixture', fixtureMeta });
    store.setProject(project);
    setAppState(APP_STATES.editor);
    setStatus(`Fixture ${fixtureId}를 불러왔습니다. 슬롯 후보 ${project.summary.totalSlotCandidates}개, 자산 ${project.summary.assetsTotal}개입니다.`);
  } catch (error) {
    setStatusWithError('초기 로딩 중 오류가 발생했습니다. 브라우저 콘솔(F12)을 확인해 주세요.', error, { logTag: 'LOAD_FIXTURE_ERROR' });
  }
}

async function openHtmlFile(file) {
  if (!file) return;
  const requestId = importRequestSequence += 1;
  try {
    const html = await file.text();
    if (requestId !== importRequestSequence) return;
    const fileIndex = createImportFileIndex([file], 'html-file');
    pendingMountOptions = { snapshot: null, preserveHistory: false };
    const project = normalizeProject({ html, sourceName: file.name, sourceType: 'html-file', fileIndex, htmlEntryPath: file.name });
    if (requestId !== importRequestSequence) return;
    store.setProject(project);
    setAppState(APP_STATES.editor);
    setStatus(`HTML 파일 ${file.name}을 불러왔습니다. 미해결 자산 ${project.summary.assetsUnresolved}개입니다.`);
  } catch (error) {
    setStatusWithError(`HTML 파일 열기 중 오류가 발생했습니다. ${IMPORT_FAILURE_GUIDES.htmlOpen}`, error, { logTag: 'OPEN_HTML_FILE_ERROR' });
  }
}

async function handleFolderImport(files) {
  const requestId = importRequestSequence += 1;
  try {
    const fileIndex = createImportFileIndex(files, 'folder-import');
    const htmlEntry = choosePrimaryHtmlEntry(fileIndex);
    if (!htmlEntry) {
      setStatus(`선택한 폴더에 HTML 파일이 없습니다. ${IMPORT_FAILURE_GUIDES.folderNoHtml}`);
      return;
    }
    const html = await htmlEntry.file.text();
    if (requestId !== importRequestSequence) return;
    pendingMountOptions = { snapshot: null, preserveHistory: false };
    const project = normalizeProject({
      html,
      sourceName: htmlEntry.relativePath,
      sourceType: 'folder-import',
      fileIndex,
      htmlEntryPath: htmlEntry.relativePath,
    });
    if (fileIndex.htmlEntries.length > 1) {
      project.issues.unshift({
        id: `issue_multi_html_${Date.now()}`,
        level: 'info',
        code: 'MULTI_HTML',
        message: `HTML 파일이 ${fileIndex.htmlEntries.length}개라서 ${htmlEntry.relativePath}를 우선 사용했습니다.`,
      });
    }
    if (requestId !== importRequestSequence) return;
    store.setProject(project);
    setAppState(APP_STATES.editor);
    setStatus(`프로젝트 폴더 import 완료: ${htmlEntry.relativePath}. resolved ${project.summary.assetsResolved}개, unresolved ${project.summary.assetsUnresolved}개입니다.`);
  } catch (error) {
    setStatusWithError(`폴더 import 중 오류가 발생했습니다. ${IMPORT_FAILURE_GUIDES.folderImport}`, error, { logTag: 'FOLDER_IMPORT_ERROR' });
  }
}

function applyPastedHtml() {
  try {
    const html = elements.htmlPasteInput.value.trim();
    if (!html) {
      setStatus('붙여넣기 HTML이 비어 있습니다.');
      return;
    }
    pendingMountOptions = { snapshot: null, preserveHistory: false };
    const project = normalizeProject({ html, sourceName: 'pasted-html', sourceType: 'paste' });
    store.setProject(project);
    setAppState(APP_STATES.editor);
    setStatus(`붙여넣기 HTML을 정규화했습니다. 슬롯 후보 ${project.summary.totalSlotCandidates}개를 찾았습니다.`);
  } catch (error) {
    setStatusWithError(`붙여넣기 적용 중 오류가 발생했습니다. ${IMPORT_FAILURE_GUIDES.pasteMalformed}`, error, { logTag: 'APPLY_PASTED_HTML_ERROR' });
  }
}

async function runDownloadByChoice(choice) {
  if (choice === 'save-edited') return downloadEditedHtml();
  if (choice === 'export-full-png') return exportFullPng();
  if (choice === 'export-full-jpg') return exportFullJpg();
  if (choice === 'export-selection-png') return exportSelectionPng();
  if (choice === 'export-sections-zip') return exportSectionsZip();
  if (choice === 'download-normalized-html') return downloadNormalizedHtml();
  if (choice === 'download-linked-zip') return downloadLinkedZip();
  if (choice === 'download-export-preset-package') return downloadExportPresetPackage();
  throw new Error(`지원하지 않는 저장/출력 선택입니다: ${choice}`);
}

function downloadNormalizedHtml() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const fileName = `${projectBaseName(project)}__normalized.html`;
  downloadTextFile(fileName, project.normalizedHtml, 'text/html;charset=utf-8');
  setStatus(`정규화 HTML을 저장했습니다: ${fileName}`);
}

async function downloadEditedHtml() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  if (!activeEditor) {
    const fileName = `${projectBaseName(project)}__edited_working.html`;
    downloadTextFile(fileName, project.normalizedHtml, 'text/html;charset=utf-8');
    setStatus(`편집 HTML을 저장했습니다: ${fileName} · 다음: 이 파일을 다시 열 때는 상단 "HTML 열기"를 누른 뒤 방금 저장한 파일을 선택하세요.`);
    return;
  }
  await downloadByFormat(currentSaveFormat);
}

function ensurePreflightBeforeExport(kind) {
  if (!activeEditor) return false;
  const preflight = activeEditor.getPreflightReport();
  if (!preflight?.blockingErrors) return true;
  const proceed = window.confirm(`출력 전 검수에서 오류 ${preflight.blockingErrors}개가 감지되었습니다.\n빈 슬롯 또는 미해결 자산이 포함될 수 있습니다.\n그래도 ${kind}을(를) 계속하시겠습니까?`);
  if (!proceed) {
    setStatus(`출력 전 검수 오류 때문에 ${kind}을(를) 중단했습니다.`);
    return false;
  }
  return true;
}

async function ensureFixtureIntegrityBeforeExport(kind) {
  if (!activeEditor) return false;
  const report = await activeEditor.getExportFixtureIntegrityReport?.();
  if (!report || report.ok) return true;
  const preview = (report.issues || []).slice(0, 3).join('\n- ');
  const proceed = window.confirm(`Fixture 기준 export 검증에서 문제를 찾았습니다.\n- ${preview}\n그래도 ${kind}을(를) 계속하시겠습니까?`);
  if (!proceed) {
    setStatus(`Fixture 기준 export 검증 문제 때문에 ${kind}을(를) 중단했습니다.`);
    return false;
  }
  return true;
}

async function downloadLinkedZip() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  if (!ensurePreflightBeforeExport('링크형 ZIP 저장')) return;
  await downloadByFormat('linked', { forceZip: true });
}

async function downloadByFormat(format, { forceZip = false } = {}) {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const saveFormat = normalizeSaveFormat(format);
  const result = await activeEditor.getSavePackageEntries(saveFormat);
  lastSaveConversion = {
    ...result.conversion,
    savedAt: new Date().toISOString(),
  };

  if (saveFormat === 'embedded' && !forceZip) {
    const entry = result.entries[0];
    const text = new TextDecoder().decode(entry.data);
    downloadTextFile(entry.name, text, 'text/html;charset=utf-8');
    setStatus(`embedded HTML을 저장했습니다: ${entry.name} (blob→data ${result.conversion?.portableRewrite?.blobConvertedToDataUrl || 0}개) · 다음: 파일을 더블클릭하거나, 상단 "HTML 열기"로 재오픈하세요.`);
    syncSaveFormatUi();
    return;
  }

  const zipBlob = await buildZipBlob(result.entries);
  const suffix = saveFormat === 'embedded' ? '__embedded_package.zip' : '__linked_package.zip';
  const fileName = `${projectBaseName(project)}${suffix}`;
  downloadBlob(fileName, zipBlob);
  const warningCount = Number(result.conversion?.brokenLinkedPathWarnings?.length || 0);
  const warningText = warningCount > 0 ? ` · 경고 ${warningCount}건(BROKEN_LINKED_PATH)` : '';
  setStatus(`${saveFormat} 패키지를 저장했습니다: ${fileName}${warningText} · 다음: ZIP 압축을 풀고 HTML + assets 폴더를 같은 위치에 둔 뒤 HTML을 다시 여세요.`);
  syncSaveFormatUi();
}

async function exportFullPng() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const autoApplied = applyAdvancedSettingsIfDirty();
  if (!ensurePreflightBeforeExport('전체 PNG 저장')) return;
  if (!(await ensureFixtureIntegrityBeforeExport('전체 PNG 저장'))) return;
  const blob = await activeEditor.exportFullPngBlob(exportScale());
  const fileName = `${projectBaseName(project)}__full.png`;
  downloadBlob(fileName, blob);
  notifySavedWithGuide('export-full-png', fileName, `${exportScale()}x${autoApplied ? ', 고급값 자동 반영' : ''}`);
}

async function exportFullJpg() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const autoApplied = applyAdvancedSettingsIfDirty();
  if (!ensurePreflightBeforeExport('전체 JPG 저장')) return;
  if (!(await ensureFixtureIntegrityBeforeExport('전체 JPG 저장'))) return;
  const quality = exportJpgQuality();
  const blob = await activeEditor.exportFullJpgBlob(exportScale(), quality);
  const fileName = `${projectBaseName(project)}__full.jpg`;
  downloadBlob(fileName, blob);
  notifySavedWithGuide('export-full-jpg', fileName, `${exportScale()}x, 품질 ${quality.toFixed(2)}${autoApplied ? ', 고급값 자동 반영' : ''}`);
}

async function exportSelectionPng() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const autoApplied = applyAdvancedSettingsIfDirty();
  if (!(await ensureFixtureIntegrityBeforeExport('선택 영역 PNG 저장'))) return;
  const options = {
    padding: selectionExportPadding(),
    background: selectionExportBackground(),
  };
  const { blob, meta } = await activeEditor.exportSelectionPngBlob(exportScale(), options);
  const fileName = `${projectBaseName(project)}__selection.png`;
  downloadBlob(fileName, blob);
  const skipped = meta?.policy?.skippedHidden + meta?.policy?.skippedLocked || 0;
  const bgLabel = options.background === 'opaque' ? '불투명(흰색)' : '투명';
  notifySavedWithGuide('export-selection-png', fileName, `${exportScale()}x, 여백 ${options.padding}px, 배경 ${bgLabel}, 포함 ${meta?.targetCount || 0}개, 제외 ${skipped}개${autoApplied ? ', 고급값 자동 반영' : ''}`);
}

async function exportSectionsZip() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const autoApplied = applyAdvancedSettingsIfDirty();
  if (!ensurePreflightBeforeExport('섹션 PNG ZIP 저장')) return;
  if (!(await ensureFixtureIntegrityBeforeExport('섹션 PNG ZIP 저장'))) return;
  const entries = await activeEditor.exportSectionPngEntries(exportScale());
  const zipBlob = await buildZipBlob(entries);
  const fileName = `${projectBaseName(project)}__sections_png.zip`;
  downloadBlob(fileName, zipBlob);
  notifySavedWithGuide('export-sections-zip', fileName, `${exportScale()}x, 섹션 ${entries.length}개${autoApplied ? ', 고급값 자동 반영' : ''}`);
}

function downloadReportJson() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const report = getEditorReport(project);
  const fileName = `${projectBaseName(project)}__editor-report.json`;
  downloadTextFile(fileName, JSON.stringify(buildReportPayload(project, report), null, 2), 'application/json;charset=utf-8');
  setStatus(`리포트 JSON을 저장했습니다: ${fileName}`);
}

async function downloadExportPresetPackage() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  applyAdvancedSettingsIfDirty();
  const preset = currentExportPreset();
  const baseName = projectBaseName(project);
  const report = getEditorReport(project);
  const entries = [];

  const addBlobEntry = async (name, blob) => {
    if (!blob) return;
    entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  };

  if (preset.bundleMode === 'basic') {
    entries.push({ name: `${baseName}__edited.html`, data: new TextEncoder().encode(activeEditor.getEditedHtml({ persistDetectedSlots: true })) });
    await addBlobEntry(`${baseName}__full.png`, await activeEditor.exportFullPngBlob(preset.scale));
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  } else if (preset.bundleMode === 'market') {
    const linked = await activeEditor.getLinkedPackageEntries();
    for (const entry of linked) entries.push({ name: `linked/${entry.name}`, data: entry.data });
    const sections = await activeEditor.exportSectionPngEntries(preset.scale);
    for (const entry of sections) entries.push({ name: `sections/${entry.name}`, data: entry.data });
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  } else if (preset.bundleMode === 'hires') {
    entries.push({ name: `${baseName}__edited.html`, data: new TextEncoder().encode(activeEditor.getEditedHtml({ persistDetectedSlots: true })) });
    await addBlobEntry(`${baseName}__full@2x.png`, await activeEditor.exportFullPngBlob(preset.scale));
    const sections = await activeEditor.exportSectionPngEntries(preset.scale);
    for (const entry of sections) entries.push({ name: `sections@2x/${entry.name}`, data: entry.data });
  } else if (preset.bundleMode === 'review') {
    entries.push({ name: `${baseName}__normalized.html`, data: new TextEncoder().encode(project.normalizedHtml) });
    await addBlobEntry(`${baseName}__review.png`, await activeEditor.exportFullPngBlob(preset.scale));
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  }

  const zip = await buildZipBlob(entries);
  const fileName = `${baseName}__${preset.id}-preset.zip`;
  downloadBlob(fileName, zip);
  notifySavedWithGuide('download-export-preset-package', fileName, `${preset.label}, 항목 ${entries.length}개`);
}

async function restoreAutosave() {
  const payload = readAutosavePayload();
  if (!payload?.snapshot?.html) return setStatus('복구할 자동저장본이 없습니다.');
  await ensureRuntimeAssetRecords(payload.snapshot.runtimeAssetIds || []);
  pendingMountOptions = { snapshot: payload.snapshot, preserveHistory: false };
  const project = normalizeProject({
    html: payload.snapshot.html,
    sourceName: payload.sourceName || 'autosave.html',
    sourceType: 'autosave',
  });
  store.setProject(project);
  setAppState(APP_STATES.editor);
  setStatus(`자동저장본을 복구했습니다. 저장 시각: ${payload.savedAt || '-'}`);
}

function applyTextStyleFromControls({ clear = false } = {}) {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const patch = clear ? {
    fontSize: '',
    lineHeight: '',
    letterSpacing: '',
    fontWeight: '',
    color: '',
    textAlign: '',
  } : (() => {
    const next = {};
    const fontSize = elements.textFontSizeInput.value.trim();
    const lineHeight = elements.textLineHeightInput.value.trim();
    const letterSpacing = elements.textLetterSpacingInput.value.trim();
    const fontWeight = elements.textWeightSelect.value;
    if (fontSize) next.fontSize = fontSize;
    if (lineHeight) next.lineHeight = lineHeight;
    if (letterSpacing) next.letterSpacing = letterSpacing;
    if (fontWeight) next.fontWeight = fontWeight;
    if (elements.textColorInput.value) next.color = elements.textColorInput.value;
    return next;
  })();
  const result = activeEditor.applyTextStyle(patch, { clear });
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
}

function applyTextStyleLive(event) {
  if (!activeEditor) return;
  const sourceControl = event?.currentTarget || null;
  const patch = {};
  if (sourceControl === elements.textFontSizeInput) patch.fontSize = elements.textFontSizeInput?.value?.trim() || '';
  if (sourceControl === elements.textLineHeightInput) patch.lineHeight = elements.textLineHeightInput?.value?.trim() || '';
  if (sourceControl === elements.textLetterSpacingInput) patch.letterSpacing = elements.textLetterSpacingInput?.value?.trim() || '';
  if (sourceControl === elements.textWeightSelect) patch.fontWeight = elements.textWeightSelect?.value || '';
  if (sourceControl === elements.textColorInput) patch.color = elements.textColorInput?.value || '';
  if (!Object.keys(patch).length) return;
  const result = activeEditor.applyTextStyle(patch);
  if (result?.ok) setStatus('텍스트 스타일을 실시간 반영했습니다.');
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
}

function applyBatchAction(action) {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.applyBatchLayout(action);
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
}

function applyStackCommand(direction = 'vertical') {
  if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  const gap = Number.parseFloat(elements.stackGapInput?.value || '24');
  const align = elements.stackAlignSelect?.value || 'start';
  const result = activeEditor.applyStackLayout({
    direction,
    gap: Number.isFinite(gap) ? gap : 24,
    align,
  });
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  return result;
}

function applyTidyCommand(axis = 'x') {
  if (!activeEditor) return { ok: false, message: '먼저 미리보기를 로드해 주세요.' };
  const result = activeEditor.tidySelection({ axis });
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  return result;
}

async function reloadCodeFromEditor() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 열어 주세요.');
  if (!activeEditor) return refreshCodeEditorFromState({ force: true });
  const html = await activeEditor.getCurrentPortableHtml();
  elements.editedCodeView.textContent = html;
  if (currentCodeSource !== 'edited') {
    currentCodeSource = 'edited';
    for (const button of elements.codeSourceButtons) {
      button.classList.toggle('is-active', button.dataset.codeSource === 'edited');
    }
  }
  refreshCodeEditorFromState({ force: true });
  setStatus('현재 편집 상태를 코드 워크벤치로 다시 불러왔습니다.');
}

function applyCodeToEditor() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 열어 주세요.');
  if (currentCodeSource === 'report') return setStatus('리포트 JSON은 편집기에 적용할 수 없습니다.');
  const html = elements.codeEditorTextarea?.value || '';
  if (!html.trim()) return setStatus('적용할 코드가 비어 있습니다.');
  const diagnostics = syncCodeWorkbenchState({ announce: false });
  const blocking = diagnostics.filter((issue) => issue.level === 'error');
  if (blocking.length) {
    const first = blocking[0];
    jumpCodeEditorToLine(first.line, first.column);
    return setStatus(`코드 적용 전 오류 ${blocking.length}개를 먼저 해결해 주세요.`);
  }
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const nextProject = normalizeProject({ html, sourceName: project.sourceName || 'edited.html', sourceType: 'code-apply' });
  lastAppliedCodeImpact = {
    sectionDelta: Number(nextProject?.summary?.sectionCount || 0) - Number(project?.summary?.sectionCount || 0),
    slotDelta: Number(nextProject?.summary?.totalSlotCandidates || 0) - Number(project?.summary?.totalSlotCandidates || 0),
    assetDelta: Number(nextProject?.summary?.assetsTotal || 0) - Number(project?.summary?.assetsTotal || 0),
    previousSource: currentCodeSource,
  };
  store.setProject(nextProject);
  codeEditorDirty = false;
  syncCodeWorkbenchState();
  setStatus('코드 워크벤치 내용을 다시 편집기에 적용했습니다.');
}


function mountHtmlAsProject(html, { sourceType = 'code-apply', mergeMode = 'full' } = {}) {
  const project = store.getState().project;
  if (!project) return false;
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const nextProject = normalizeProject({ html, sourceName: project.sourceName || 'edited.html', sourceType });
  lastAppliedCodeImpact = {
    sectionDelta: Number(nextProject?.summary?.sectionCount || 0) - Number(project?.summary?.sectionCount || 0),
    slotDelta: Number(nextProject?.summary?.totalSlotCandidates || 0) - Number(project?.summary?.totalSlotCandidates || 0),
    assetDelta: Number(nextProject?.summary?.assetsTotal || 0) - Number(project?.summary?.assetsTotal || 0),
    previousSource: currentCodeSource,
    mergeMode,
  };
  store.setProject(nextProject);
  codeEditorDirty = false;
  syncCodeWorkbenchState();
  return true;
}

function safeApplyCodeToEditor() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 열어 주세요.');
  if (currentCodeSource === 'report') return setStatus('리포트 JSON은 안전 적용할 수 없습니다.');
  const html = elements.codeEditorTextarea?.value || '';
  if (!html.trim()) return setStatus('적용할 코드가 비어 있습니다.');
  const diagnostics = syncCodeWorkbenchState({ announce: false });
  const blocking = diagnostics.filter((issue) => issue.level === 'error');
  if (blocking.length) {
    const first = blocking[0];
    jumpCodeEditorToLine(first.line, first.column);
    return setStatus(`코드 적용 전 오류 ${blocking.length}개를 먼저 해결해 주세요.`);
  }
  const currentHtml = getBestEditedHtml(store.getState()) || project.normalizedHtml || '';
  const merged = safeMergeHtmlDraft(currentHtml, html);
  if (!merged.ok) {
    return setStatus(`안전 적용을 중단했습니다. ${merged.message || '구조 차이가 커서 전체 적용이 더 적합합니다.'}`);
  }
  mountHtmlAsProject(merged.html, { sourceType: 'code-safe-merge', mergeMode: 'safe-merge' });
  setStatus(`안전 적용 완료 · 공유 UID ${merged.summary.sharedNodes}개, 텍스트 ${merged.summary.mergedTextNodes}건, 속성 ${merged.summary.mergedAttributeGroups}건을 병합했습니다.`);
}

function searchCodeNext() {
  const textarea = elements.codeEditorTextarea;
  const keyword = elements.codeSearchInput?.value || '';
  if (!textarea || !keyword) return setStatus('검색어를 입력해 주세요.');
  const source = textarea.value || '';
  const start = textarea.selectionEnd || 0;
  let index = source.indexOf(keyword, start);
  if (index < 0 && start > 0) index = source.indexOf(keyword, 0);
  if (index < 0) return setStatus('일치하는 코드가 없습니다.');
  textarea.focus();
  textarea.setSelectionRange(index, index + keyword.length);
  const line = source.slice(0, index).split('\n').length;
  setStatus(`코드 검색 결과 ${line}번째 줄로 이동했습니다.`);
}

store.subscribe((state) => {
  const shouldMount = pendingMountOptions || (state.project?.id || '') !== mountedProjectId;
  if (shouldMount) {
    const options = pendingMountOptions || {};
    pendingMountOptions = null;
    mountProject(state.project, options);
  }
  renderShell(store.getState());
});

function safeBoot() {
  try {
    setAppState(APP_STATES.launch);
    populateFixtureSelect();
    populateExportPresetSelect();
    syncExportPresetUi({ forceScale: true });
    refreshLauncherRecentButton();
    const bootEnvironmentReport = evaluateLocalBootEnvironment();
    renderLocalModeNotice(elements.localModeNotice, bootEnvironmentReport);
    renderShortcutHelpList();
    if (bootEnvironmentReport.errorCount || bootEnvironmentReport.warningCount) {
      setStatus(`환경 점검: 오류 ${bootEnvironmentReport.errorCount}개 · 경고 ${bootEnvironmentReport.warningCount}개`);
    }
    ensureThemeStudioLayout();
    renderEmptyPreview();
    syncWorkflowGuide(store.getState());
    setThemeStudioMode(themeStudioMode);
  } catch (error) {
    console.error('[BOOT_ERROR]', error);
    setStatusWithError('초기 로딩 중 오류가 발생했습니다. 브라우저 콘솔(F12)을 확인해 주세요.', error, { logTag: '' });
  }
}

safeBoot();
onboardingCompleted = hasCompletedOnboarding();
renderOnboardingChecklist();

function bindEvents() {
  initNumericSteppers();
  const logMissingElement = (elementName, context) => {
    console.warn(`[${context}] 필수 요소 누락: #${elementName}`);
  };
  const bindElementEvent = (elementName, eventName, handler, options) => {
    const target = elements[elementName];
    if (!target) {
      logMissingElement(elementName, 'bindEvents');
      return;
    }
    target.addEventListener(eventName, handler, options);
  };
  const requiredElementNames = [
    'openHtmlButton',
    'openFolderButton',
    'loadFixtureButton',
    'applyPasteButton',
    'replaceImageButton',
    'manualSlotButton',
    'toggleHideButton',
    'toggleLockButton',
    'demoteSlotButton',
    'redetectButton',
    'preflightRefreshButton',
    'applyTextStyleButton',
    'clearTextStyleButton',
    'undoButton',
    'redoButton',
    'restoreAutosaveButton',
    'saveProjectSnapshotButton',
    'saveSnapshotFromPanelButton',
    'downloadReportButton',
    'exportPresetSelect',
    'htmlFileInput',
    'folderInput',
    'replaceImageInput',
    'assetFilterInput',
    'layerFilterInput',
    'slotList',
    'layerTree',
    'snapshotList',
  ];
  for (const elementName of requiredElementNames) {
    if (!elements[elementName]) {
      logMissingElement(elementName, 'bindEvents');
    }
  }

for (const button of elements.selectionModeButtons) button.addEventListener('click', () => {
  setSelectionMode(button.dataset.selectionMode);
});
if (elements.workflowGuideSelect) elements.workflowGuideSelect.addEventListener('change', () => syncWorkflowGuide(store.getState(), { announce: true }));
for (const button of elements.presetButtons) {
  button.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.applyImagePreset(button.dataset.preset);
    setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}
for (const button of elements.actionButtons) {
  button.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    if (button.dataset.action === 'remove-image') {
      const result = activeEditor.removeImageFromSelected();
      setStatus(result.message);
      if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
    }
  });
}
for (const button of elements.batchActionButtons) button.addEventListener('click', () => applyBatchAction(button.dataset.batchAction));

elements.applyImagePresetButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const preset = elements.imagePresetSelect?.value || 'cover';
  const result = activeEditor.applyImagePreset(preset);
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.removeImageActionButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.removeImageFromSelected();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.applyCodeComparePresetButton?.addEventListener('click', () => {
  applyCodeComparePreset(elements.codeComparePresetSelect?.value || 'draft-vs-current');
});
elements.codeCompareIssuesOnlyButton?.addEventListener('click', () => {
  codeCompareIssuesOnly = !codeCompareIssuesOnly;
  syncCodeCompareCompactControls();
  renderCodeComparePanel();
});
elements.sectionThumbnailPresetSelect?.addEventListener('change', (event) => {
  currentSectionThumbnailPreset = normalizeSectionThumbnailPreset(event.target.value || 'auto');
  writeToLocalStorage(SECTION_THUMBNAIL_PRESET_STORAGE_KEY, currentSectionThumbnailPreset);
  hydrateSectionFilmstripPreviews();
});

elements.batchActionSelect?.addEventListener('change', () => {
  if (elements.applyBatchActionButton) elements.applyBatchActionButton.disabled = !activeEditor || Number(store.getState().editorMeta?.selectionCount || 0) < 2 || !elements.batchActionSelect?.value;
});
elements.applyBatchActionButton?.addEventListener('click', () => {
  const action = elements.batchActionSelect?.value || '';
  if (!action) return setStatus('적용할 다중 정렬을 먼저 선택해 주세요.');
  applyBatchAction(action);
});
elements.stackApplyButton?.addEventListener('click', () => {
  const direction = elements.stackDirectionSelect?.value || 'vertical';
  applyStackCommand(direction);
});
elements.tidyApplyButton?.addEventListener('click', () => {
  const axis = elements.tidyAxisSelect?.value || 'x';
  applyTidyCommand(axis);
});
elements.settingsQaChecklistButton?.addEventListener('click', () => setQaChecklistOpen(true));
elements.closeQaChecklistButton?.addEventListener('click', () => setQaChecklistOpen(false));
elements.qaChecklistModal?.addEventListener('click', (event) => {
  if (event.target === elements.qaChecklistModal) setQaChecklistOpen(false);
});
elements.stackHorizontalButton?.addEventListener('click', () => applyStackCommand('horizontal'));
elements.stackVerticalButton?.addEventListener('click', () => applyStackCommand('vertical'));
elements.tidyHorizontalButton?.addEventListener('click', () => applyTidyCommand('x'));
elements.tidyVerticalButton?.addEventListener('click', () => applyTidyCommand('y'));
elements.commandPaletteInput?.addEventListener('input', updateCommandPaletteResults);
elements.commandPaletteInput?.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    commandPaletteActiveIndex = Math.min(commandPaletteResults.length - 1, commandPaletteActiveIndex + 1);
    renderCommandPaletteResults();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    commandPaletteActiveIndex = Math.max(0, commandPaletteActiveIndex - 1);
    renderCommandPaletteResults();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    runActiveCommandPaletteItem();
  }
});
elements.commandPaletteRunButton?.addEventListener('click', runActiveCommandPaletteItem);
elements.commandPaletteCloseButton?.addEventListener('click', () => toggleCommandPalette(false));
for (const button of elements.canvasActionButtons) {
  button.addEventListener('click', () => {
    const result = executeCanvasContextAction(button.dataset.canvasAction);
    if (result?.message) setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}
elements.textAlignSelect?.addEventListener('change', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.applyTextStyle({ textAlign: elements.textAlignSelect?.value || '' });
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
for (const control of [
  elements.textFontSizeInput,
  elements.textLineHeightInput,
  elements.textLetterSpacingInput,
  elements.textWeightSelect,
  elements.textColorInput,
]) {
  const eventName = control?.tagName === 'SELECT' ? 'change' : 'input';
  control?.addEventListener(eventName, applyTextStyleLive);
}
elements.applyCanvasGeometryButton?.addEventListener('click', () => {
  if (elements.geometryXInput) elements.geometryXInput.value = elements.canvasGeometryXInput?.value || '';
  if (elements.geometryYInput) elements.geometryYInput.value = elements.canvasGeometryYInput?.value || '';
  if (elements.geometryWInput) elements.geometryWInput.value = elements.canvasGeometryWInput?.value || '';
  if (elements.geometryHInput) elements.geometryHInput.value = elements.canvasGeometryHInput?.value || '';
  const result = applyGeometryFromInputs();
  setStatus(result.message);
});
for (const [canvasInput, sourceInput] of [
  [elements.canvasGeometryXInput, elements.geometryXInput],
  [elements.canvasGeometryYInput, elements.geometryYInput],
  [elements.canvasGeometryWInput, elements.geometryWInput],
  [elements.canvasGeometryHInput, elements.geometryHInput],
]) {
  canvasInput?.addEventListener('input', () => {
    if (!sourceInput) return;
    sourceInput.value = canvasInput.value;
    const result = applyGeometryFromInputs();
    if (result.ok) setStatus(result.message);
  });
}

elements.openHtmlButton?.addEventListener('click', () => elements.htmlFileInput?.click());
elements.launcherUploadButton?.addEventListener('click', () => elements.htmlFileInput?.click());
elements.launcherRecentButton?.addEventListener('click', () => {
  const payload = readAutosavePayload();
  if (!payload?.snapshot?.html) {
    refreshLauncherRecentButton();
    setStatus('복구할 자동저장본이 없습니다.');
    return;
  }
  restoreAutosave().catch((error) => setStatus(`자동저장 복구 중 오류: ${error?.message || error}`));
});
for (const button of elements.launcherFixtureButtons) {
  button.addEventListener('click', () => {
    const fixtureId = button.dataset.launchFixture || '';
    if (!fixtureId) return;
    loadFixture(fixtureId);
  });
}
elements.openFolderButton?.addEventListener('click', () => elements.folderInput?.click());
elements.loadFixtureButton?.addEventListener('click', () => loadFixture(elements.fixtureSelect?.value));
elements.applyPasteButton?.addEventListener('click', applyPastedHtml);
elements.replaceImageButton?.addEventListener('click', () => {
  elements.replaceImageInput?.click();
  advanceOnboardingByAction('replace-image');
});
elements.manualSlotButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.markSelectedAsSlot();
  setStatus(result.message);
  if (result?.ok !== false) advanceOnboardingByAction('slot-select');
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.toggleHideButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.toggleSelectedHidden();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.arrangeToggleHideButton?.addEventListener('click', () => elements.toggleHideButton?.click());
elements.toggleLockButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.toggleSelectedLocked();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.arrangeToggleLockButton?.addEventListener('click', () => elements.toggleLockButton?.click());
elements.demoteSlotButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.demoteSelectedSlot();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.redetectButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  activeEditor.redetect();
  setStatus('슬롯 자동 감지를 다시 실행했습니다.');
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.textEditButton?.addEventListener('click', () => {
  executeEditorCommand('toggle-text-edit');
});
elements.duplicateButton?.addEventListener('click', () => { executeEditorCommand('duplicate'); });
elements.deleteButton?.addEventListener('click', () => { executeEditorCommand('delete'); });
elements.groupButton?.addEventListener('click', () => { executeEditorCommand('group-selection'); });
elements.ungroupButton?.addEventListener('click', () => { executeEditorCommand('ungroup-selection'); });
elements.addTextButton?.addEventListener('click', () => {
  executeEditorCommand('add-element-text');
});
elements.addBoxButton?.addEventListener('click', () => {
  executeEditorCommand('add-element-box');
});
elements.addSlotButton?.addEventListener('click', () => {
  executeEditorCommand('add-element-slot');
});
elements.applyGeometryButton?.addEventListener('click', () => {
  const result = applyGeometryFromInputs();
  setStatus(result.message);
});
elements.geometryCoordModeSelect?.addEventListener('change', () => {
  markAdvancedSettingsDirty(true);
  setStatus('좌표 기준 변경 대기 중입니다. "고급값 적용" 버튼을 눌러 반영하세요.');
});
for (const input of [elements.geometryXInput, elements.geometryYInput, elements.geometryWInput, elements.geometryHInput]) {
  input?.addEventListener('input', () => {
    if (!activeEditor) return;
    const result = applyGeometryFromInputs();
    if (result.ok) setStatus(result.message);
  });
}
elements.bringForwardButton?.addEventListener('click', () => {
  executeEditorCommand('layer-index-forward');
});
elements.sendBackwardButton?.addEventListener('click', () => {
  executeEditorCommand('layer-index-backward');
});
elements.bringToFrontButton?.addEventListener('click', () => {
  executeEditorCommand('layer-index-front');
});
elements.sendToBackButton?.addEventListener('click', () => {
  executeEditorCommand('layer-index-back');
});
elements.imageNudgeLeftButton?.addEventListener('click', () => setStatus(activeEditor?.nudgeSelectedImage({ dx: -2, dy: 0 })?.message || '먼저 미리보기를 로드해 주세요.'));
elements.imageNudgeRightButton?.addEventListener('click', () => setStatus(activeEditor?.nudgeSelectedImage({ dx: 2, dy: 0 })?.message || '먼저 미리보기를 로드해 주세요.'));
elements.imageNudgeUpButton?.addEventListener('click', () => setStatus(activeEditor?.nudgeSelectedImage({ dx: 0, dy: -2 })?.message || '먼저 미리보기를 로드해 주세요.'));
elements.imageNudgeDownButton?.addEventListener('click', () => setStatus(activeEditor?.nudgeSelectedImage({ dx: 0, dy: 2 })?.message || '먼저 미리보기를 로드해 주세요.'));
elements.preflightRefreshButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  activeEditor.refreshDerivedMeta();
  setStatus('출력 전 검수를 다시 계산했습니다.');
});
elements.applyTextStyleButton?.addEventListener('click', () => applyTextStyleFromControls({ clear: false }));
elements.clearTextStyleButton?.addEventListener('click', () => applyTextStyleFromControls({ clear: true }));
elements.undoButton?.addEventListener('click', undoHistory);
elements.redoButton?.addEventListener('click', redoHistory);
elements.restoreAutosaveButton?.addEventListener('click', () => { restoreAutosave().catch((error) => setStatus(`자동저장 복구 중 오류: ${error?.message || error}`)); });
elements.saveProjectSnapshotButton?.addEventListener('click', () => {
  createProjectSnapshot({
    title: elements.snapshotNameInput?.value || '',
    note: '',
    auto: false,
    statusMessage: '작업 시점을 스냅샷으로 저장했습니다.',
  });
});
elements.saveSnapshotFromPanelButton?.addEventListener('click', () => {
  createProjectSnapshot({
    title: elements.snapshotNameInput?.value || '',
    note: '',
    auto: false,
    statusMessage: '스냅샷 목록에 새 시점을 추가했습니다.',
  });
});
elements.snapshotList?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const action = target?.closest?.('[data-snapshot-action]')?.getAttribute('data-snapshot-action') || '';
  if (!action) return;
  const card = target.closest('[data-snapshot-id]');
  const snapshotId = card?.getAttribute('data-snapshot-id') || '';
  if (!snapshotId) return;
  if (action === 'restore') return restoreProjectSnapshotById(snapshotId).catch((error) => setStatus(`스냅샷 복원 중 오류: ${error?.message || error}`));
  if (action === 'delete') return deleteProjectSnapshotById(snapshotId);
});
elements.openDownloadModalButton?.addEventListener('click', () => toggleDownloadModal(true));
for (const button of elements.appActionButtons || []) {
  button?.addEventListener('click', () => {
    const action = button.dataset.appAction || '';
    if (action === 'open-download-modal') {
      toggleDownloadModal(true);
      return;
    }
    if (action === 'refresh-assets') {
      refreshAllUI(store.getState());
      setStatus('업로드/자산 목록을 새로고침했습니다.');
    }
  });
}
elements.closeDownloadModalButton?.addEventListener('click', () => toggleDownloadModal(false));
elements.downloadChoiceSelect?.addEventListener('change', () => renderShell(store.getState()));
elements.runDownloadChoiceButton?.addEventListener('click', async () => {
  const choice = elements.downloadChoiceSelect?.value || 'save-edited';
  try {
    await runDownloadByChoice(choice);
    toggleDownloadModal(false);
  } catch (error) {
    setStatus(`저장/출력 중 오류: ${error?.message || error}`);
  }
});
for (const button of elements.downloadEditedButtons) {
  button?.addEventListener('click', () => { runDownloadByChoice('save-edited').catch((error) => setStatus(`문서 저장 중 오류: ${error?.message || error}`)); });
}
elements.downloadNormalizedButton?.addEventListener('click', () => { runDownloadByChoice('download-normalized-html').catch((error) => setStatus(`정규화 HTML 저장 중 오류: ${error?.message || error}`)); });
elements.downloadLinkedZipButton?.addEventListener('click', () => { runDownloadByChoice('download-linked-zip').catch((error) => setStatus(`ZIP 저장 중 오류: ${error?.message || error}`)); });
for (const button of elements.exportPngButtons) {
  button?.addEventListener('click', () => {
    runDownloadByChoice('export-full-png').catch((error) => setStatus(`PNG 저장 중 오류: ${error?.message || error}`));
    advanceOnboardingByAction('save-png');
  });
}
for (const button of elements.exportJpgButtons) {
  button?.addEventListener('click', () => { runDownloadByChoice('export-full-jpg').catch((error) => setStatus(`JPG 저장 중 오류: ${error?.message || error}`)); });
}
elements.exportSectionsZipButton?.addEventListener('click', () => { runDownloadByChoice('export-sections-zip').catch((error) => setStatus(`섹션 PNG ZIP 저장 중 오류: ${error?.message || error}`)); });
elements.exportSelectionPngButton?.addEventListener('click', () => { runDownloadByChoice('export-selection-png').catch((error) => setStatus(`선택 PNG 저장 중 오류: ${error?.message || error}`)); });
elements.exportPresetPackageButton?.addEventListener('click', () => { runDownloadByChoice('download-export-preset-package').catch((error) => setStatus(`Preset 패키지 저장 중 오류: ${error?.message || error}`)); });
for (const button of elements.downloadPresetButtons) {
  button?.addEventListener('click', () => {
    const presetId = button.dataset.downloadPreset || 'market';
    const recommendedChoice = button.dataset.downloadChoice || '';
    currentExportPresetId = presetId;
    if (recommendedChoice && elements.downloadChoiceSelect) elements.downloadChoiceSelect.value = recommendedChoice;
    syncExportPresetUi({ forceScale: true });
    setStatus(`목적 카드 선택: ${currentExportPreset().label} · 실행할 작업은 ${elements.downloadChoiceSelect?.value || 'save-edited'}로 맞췄습니다.`);
  });
}
elements.saveFormatSelect?.addEventListener('change', () => {
  currentSaveFormat = normalizeSaveFormat(elements.saveFormatSelect.value || 'linked');
  syncSaveFormatUi();
  setStatus(`저장 포맷을 ${currentSaveFormat}로 변경했습니다.`);
});
bindElementEvent('downloadReportButton', 'click', downloadReportJson);
elements.exportPresetSelect?.addEventListener('change', () => {
  currentExportPresetId = elements.exportPresetSelect.value || 'default';
  syncExportPresetUi({ forceScale: true });
  setStatus(`Export preset: ${currentExportPreset().label} (배율은 고급값 적용 버튼으로 반영)`);
});
for (const control of elements.exportScaleSelectControls) {
  control?.addEventListener('change', (event) => {
    const sourceControl = event?.currentTarget || null;
    syncMirroredControls(elements.exportScaleSelectControls, sourceControl?.value || '1', sourceControl);
    markAdvancedSettingsDirty(true);
  });
}
for (const control of elements.exportJpgQualityInputs) {
  control?.addEventListener('input', (event) => {
    const sourceControl = event?.currentTarget || null;
    syncMirroredControls(elements.exportJpgQualityInputs, sourceControl?.value || String(DEFAULT_JPG_QUALITY), sourceControl);
    markAdvancedSettingsDirty(true);
  });
}
elements.selectionExportPaddingInput?.addEventListener('input', () => markAdvancedSettingsDirty(true));
elements.selectionExportBackgroundSelect?.addEventListener('change', () => markAdvancedSettingsDirty(true));
elements.applyAdvancedSettingsButton?.addEventListener('click', () => {
  const result = applyAdvancedSettingsFromForm();
  setStatus(result.message);
});

elements.htmlFileInput?.addEventListener('change', async (event) => {
  const fileList = event.target?.files;
  const file = fileList && fileList.length > 0 ? fileList[0] : null;
  try {
    await openHtmlFile(file);
  } finally {
    event.target.value = '';
  }
});

elements.folderInput?.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  try {
    if (files.length) await handleFolderImport(files);
  } finally {
    event.target.value = '';
  }
});

elements.replaceImageInput?.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  try {
    if (!files.length) return;
    if (!activeEditor) {
      const message = '먼저 미리보기를 로드해 주세요.';
      setStatus(message);
      store.setImageApplyDiagnostic(buildImageFailureDiagnostic({ files, editorMeta: store.getState().editorMeta, statusMessage: message }));
      return;
    }
    const applied = await activeEditor.applyFiles(files);
    if (applied) {
      setStatus(`${applied}개 이미지를 적용했습니다.`);
      store.setImageApplyDiagnostic(null);
    } else {
      const message = '이미지를 적용하지 못했습니다.';
      setStatus(message);
      store.setImageApplyDiagnostic(buildImageFailureDiagnostic({ files, editorMeta: store.getState().editorMeta, statusMessage: message }));
    }
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  } catch (error) {
    const message = `이미지 적용 중 오류: ${error?.message || error}`;
    setStatus(message);
    store.setImageApplyDiagnostic(buildImageFailureDiagnostic({ files, editorMeta: store.getState().editorMeta, statusMessage: message }));
  } finally {
    event.target.value = '';
  }
});

bindElementEvent('assetFilterInput', 'input', () => {
  if (!elements.assetTableWrap) {
    logMissingElement('assetTableWrap', 'assetFilterInput');
    return;
  }
  renderAssetTable(elements.assetTableWrap, store.getState().project, elements.assetFilterInput?.value || '');
});
elements.layerFilterInput?.addEventListener('input', () => renderLayerTree(elements.layerTree, store.getState().editorMeta, elements.layerFilterInput?.value || ''));

function isSectionDragLeavingList(event) {
  const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
  if (related && elements.sectionList?.contains(related)) return false;
  if (!elements.sectionList) return true;
  const rect = elements.sectionList.getBoundingClientRect();
  const clientX = Number(event?.clientX || -1);
  const clientY = Number(event?.clientY || -1);
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom;
}

elements.slotList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-slot-uid]');
  if (!button || !activeEditor) return;
  const ok = activeEditor.selectNodeByUid(button.dataset.slotUid, { additive: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey, scroll: true });
  if (ok) setStatus('슬롯을 선택했습니다.');
});
elements.sectionList?.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-section-action][data-section-uid]');
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    applySectionAction(actionButton.dataset.sectionAction || '', actionButton.dataset.sectionUid || '', { fromMenu: true });
    return;
  }
  if (event.target.closest('[data-section-menu]')) return;
  const card = event.target.closest('[data-section-card][data-section-uid]');
  if (!card || !activeEditor) return;
  const uid = card.dataset.sectionUid || '';
  if (!uid) return;
  if (event.shiftKey) {
    rangeSelectSections(uid, { scroll: true });
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    toggleSectionPanelSelection(uid, { scroll: false });
    return;
  }
  setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll: true, silent: true });
  scrollToSectionUid(uid, { behavior: 'smooth' });
  setStatus('섹션으로 이동했습니다.');
});

elements.sectionList?.addEventListener('contextmenu', (event) => {
  const card = event.target.closest('[data-section-card][data-section-uid]');
  if (!card) return;
  event.preventDefault();
  const uid = card.dataset.sectionUid || '';
  if (!getSectionPanelSelection().includes(uid)) {
    setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll: false, silent: true });
  }
  document.querySelectorAll('[data-section-menu][open]').forEach((node) => {
    node.removeAttribute('open');
    node.classList.remove('is-context');
  });
  const menu = card.querySelector('[data-section-menu]');
  if (menu) {
    menu.style.setProperty('--context-x', `${Math.round(event.clientX + 4)}px`);
    menu.style.setProperty('--context-y', `${Math.round(event.clientY + 4)}px`);
    menu.classList.add('is-context');
    menu.setAttribute('open', '');
    menu.querySelector('.section-card-menu__quick-action, button')?.focus?.();
  }
});

elements.sectionList?.addEventListener('pointerover', (event) => {
  const card = event.target?.closest?.('[data-section-card][data-section-uid]');
  if (!card) return;
  const uid = card.dataset.sectionUid || '';
  if (!uid || hoveredSectionPreviewUid === uid) return;
  hoveredSectionPreviewUid = uid;
  hydrateSectionFilmstripPreviews();
});
elements.sectionList?.addEventListener('pointerleave', () => {
  if (!hoveredSectionPreviewUid) return;
  hoveredSectionPreviewUid = '';
  hydrateSectionFilmstripPreviews();
});

elements.sectionList?.addEventListener('dragstart', (event) => {
  const card = event.target?.closest?.('[data-section-card][data-section-uid]');
  if (!card || !event.dataTransfer) return;
  const uid = card.getAttribute('data-section-uid') || '';
  if (!uid) return;
  const selected = getSectionPanelSelection();
  const dragUids = selected.includes(uid) ? selected : [uid];
  if (!selected.includes(uid)) setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll: false, silent: true });
  clearSectionDragVisuals();
  sectionDragState.uid = uid;
  sectionDragState.uids = dragUids;
  sectionDragState.targetUid = '';
  sectionDragState.position = 'after';
  elements.sectionList?.classList.add('is-drag-active');
  for (const dragUid of dragUids) {
    elements.sectionList?.querySelector(`[data-section-card][data-section-uid="${dragUid}"]`)?.classList.add('is-dragging');
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-detail-section-uid', uid);
  event.dataTransfer.setData('application/x-detail-section-uids', JSON.stringify(dragUids));
  event.dataTransfer.setData('text/plain', uid);
});

elements.sectionList?.addEventListener('dragover', (event) => {
  const uid = sectionDragState.uid || String(event.dataTransfer?.getData?.('application/x-detail-section-uid') || '').trim();
  if (!uid) return;
  const card = event.target?.closest?.('[data-section-card][data-section-uid]');
  if (!card) return;
  const targetUid = card.getAttribute('data-section-uid') || '';
  const draggingSet = new Set(sectionDragState.uids?.length ? sectionDragState.uids : [uid]);
  if (!targetUid || draggingSet.has(targetUid)) return;
  event.preventDefault();
  elements.sectionList?.classList.add('is-drag-active');
  const rect = card.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  sectionDragState.targetUid = targetUid;
  sectionDragState.position = position;
  for (const node of elements.sectionList.querySelectorAll('.drop-before, .drop-after, .is-drop-target-before, .is-drop-target-after')) {
    node.classList.remove('drop-before', 'drop-after', 'is-drop-target-before', 'is-drop-target-after');
  }
  card.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
  card.classList.add(position === 'before' ? 'is-drop-target-before' : 'is-drop-target-after');
});

elements.sectionList?.addEventListener('drop', (event) => {
  const uid = sectionDragState.uid || String(event.dataTransfer?.getData?.('application/x-detail-section-uid') || '').trim();
  if (!uid || !activeEditor) return;
  const card = event.target?.closest?.('[data-section-card][data-section-uid]');
  if (!card) return;
  event.preventDefault();
  const targetUid = sectionDragState.targetUid || card.getAttribute('data-section-uid') || '';
  if (!targetUid) return;
  const position = sectionDragState.position || 'after';
  const dragUids = sectionDragState.uids?.length ? sectionDragState.uids : [uid];
  const result = dragUids.length > 1 && activeEditor.moveSectionsRelativeByUidList
    ? activeEditor.moveSectionsRelativeByUidList(dragUids, targetUid, position)
    : activeEditor.moveSectionRelativeByUid(uid, targetUid, position);
  setStatus(result?.message || '섹션 순서를 바꿨습니다.');
  sectionDragState.uid = '';
  sectionDragState.uids = [];
  clearSectionDragVisuals();
});

elements.sectionList?.addEventListener('dragleave', (event) => {
  if (!sectionDragState.uid) return;
  if (isSectionDragLeavingList(event)) clearSectionDragVisuals();
});

elements.sectionList?.addEventListener('dragend', () => {
  sectionDragState.uid = '';
  sectionDragState.uids = [];
  clearSectionDragVisuals();
});

document.addEventListener('drop', () => {
  if (!sectionDragState.uid) return;
  sectionDragState.uid = '';
  sectionDragState.uids = [];
  clearSectionDragVisuals();
}, true);

document.addEventListener('dragend', () => {
  if (!sectionDragState.uid) return;
  sectionDragState.uid = '';
  sectionDragState.uids = [];
  clearSectionDragVisuals();
}, true);

document.addEventListener('click', (event) => {
  if (event.target?.closest?.('[data-section-menu]')) return;
  document.querySelectorAll('[data-section-menu][open]').forEach((node) => {
    node.removeAttribute('open');
    node.classList.remove('is-context');
  });
});

elements.sectionList?.addEventListener('keydown', (event) => {
  const card = event.target.closest('[data-section-card][data-section-uid]');
  if (!card || !activeEditor) return;
  const uid = card.dataset.sectionUid || '';
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (event.shiftKey) rangeSelectSections(uid, { scroll: true });
    else setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll: true, silent: true });
    scrollToSectionUid(uid, { behavior: 'smooth' });
    setStatus('섹션으로 이동했습니다.');
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    applySectionAction('delete', uid, { fromMenu: false });
    return;
  }
  if (event.key === 'ArrowUp' && event.altKey) {
    event.preventDefault();
    applySectionAction('move-up', uid, { fromMenu: false });
    return;
  }
  if (event.key === 'ArrowDown' && event.altKey) {
    event.preventDefault();
    applySectionAction('move-down', uid, { fromMenu: false });
  }
});
elements.uploadAssetLibrary?.addEventListener('dragstart', (event) => {
  const card = event.target?.closest?.('[data-asset-ref]');
  if (!card || !event.dataTransfer) return;
  const ref = card.getAttribute('data-asset-ref') || '';
  const label = card.getAttribute('data-asset-label') || '';
  if (!ref) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-detail-asset-ref', ref);
  event.dataTransfer.setData('application/x-detail-asset-label', label);
  event.dataTransfer.setData('text/plain', ref);
});

elements.uploadAssetLibrary?.addEventListener('click', async (event) => {
  const card = event.target?.closest?.('[data-asset-ref]');
  if (!card) return;
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const ref = card.getAttribute('data-asset-ref') || '';
  const label = card.getAttribute('data-asset-label') || '';
  if (!ref) return;
  const result = await activeEditor.applyAssetReferenceToSelectedSlot(ref, label);
  setStatus(result?.message || '이미지를 적용했습니다.');
});

elements.selectionInspector?.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-image-diagnostic-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.imageDiagnosticAction || '';
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  if (action === 'select-first-slot') {
    const firstSlotUid = store.getState().editorMeta?.slots?.[0]?.uid || '';
    if (!firstSlotUid) return setStatus('선택할 슬롯이 없습니다.');
    const ok = activeEditor.selectSlotByUid(firstSlotUid);
    return setStatus(ok ? '첫 슬롯을 선택했습니다. 이제 이미지를 다시 넣어보세요.' : '첫 슬롯 선택에 실패했습니다.');
  }
  if (action === 'show-filename-rule') {
    return setStatus('파일명 규칙: 슬롯 라벨(또는 uid) 일부를 파일명에 넣어 주세요. 예) hero-slot.jpg');
  }
  if (action === 'show-supported-extensions') {
    return setStatus(`지원 확장자: ${SUPPORTED_IMAGE_EXTENSIONS_TEXT}`);
  }
});
elements.sectionDuplicateButton?.addEventListener('click', () => {
  const selection = getSectionPanelSelection();
  const uid = selection[selection.length - 1] || store.getState().editorMeta?.selectedSectionUid || '';
  applySectionAction('duplicate', uid, { fromMenu: false });
});
elements.sectionMoveUpButton?.addEventListener('click', () => {
  const selection = getSectionPanelSelection();
  const uid = selection[selection.length - 1] || store.getState().editorMeta?.selectedSectionUid || '';
  applySectionAction('move-up', uid, { fromMenu: false });
});
elements.sectionMoveDownButton?.addEventListener('click', () => {
  const selection = getSectionPanelSelection();
  const uid = selection[selection.length - 1] || store.getState().editorMeta?.selectedSectionUid || '';
  applySectionAction('move-down', uid, { fromMenu: false });
});
elements.sectionDeleteButton?.addEventListener('click', () => {
  const selection = getSectionPanelSelection();
  const uid = selection[selection.length - 1] || store.getState().editorMeta?.selectedSectionUid || '';
  applySectionAction('delete', uid, { fromMenu: false });
});
elements.sectionAddButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const uid = store.getState().editorMeta?.selectedSectionUid || '';
  const result = activeEditor.addSectionAfterUid(uid);
  setStatus(result.message);
});
elements.layerTree?.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-layer-action][data-layer-uid]');
  if (actionButton && activeEditor) {
    event.preventDefault();
    event.stopPropagation();
    const uid = actionButton.dataset.layerUid;
    const result = actionButton.dataset.layerAction === 'hide'
      ? activeEditor.toggleLayerHiddenByUid(uid)
      : activeEditor.toggleLayerLockedByUid(uid);
    setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
    return;
  }
  const button = event.target.closest('[data-layer-uid]');
  if (!button || !activeEditor) return;
  const ok = activeEditor.selectNodeByUid(button.dataset.layerUid, { additive: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey, scroll: true });
  if (ok) setStatus('레이어를 선택했습니다.');
});
elements.layerTree?.addEventListener('keydown', (event) => {
  const key = String(event.key || '');
  if (key !== 'Enter' && key !== ' ') return;
  const row = event.target.closest?.('[data-layer-uid]');
  if (!row || !activeEditor) return;
  event.preventDefault();
  const ok = activeEditor.selectNodeByUid(row.dataset.layerUid, { additive: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey, scroll: true });
  if (ok) setStatus('레이어를 선택했습니다.');
});
for (const button of elements.sidebarTabButtons) {
  button.addEventListener('click', () => setSidebarTab(button.dataset.sidebarTab));
}
for (const button of elements.codeSourceButtons) {
  button.addEventListener('click', () => setCodeSource(button.dataset.codeSource, { preserveDraft: false }));
}
elements.codeCompareBaseSelect?.addEventListener('change', (event) => {
  codeCompareBaseMode = event.target.value || 'current-source';
  renderCodeComparePanel();
});
elements.codeCompareTargetSelect?.addEventListener('change', (event) => {
  codeCompareTargetMode = event.target.value || 'draft';
  renderCodeComparePanel();
});
elements.codeCompareSwapButton?.addEventListener('click', () => {
  const previousBase = codeCompareBaseMode;
  codeCompareBaseMode = codeCompareTargetMode;
  codeCompareTargetMode = previousBase;
  if (elements.codeCompareBaseSelect) elements.codeCompareBaseSelect.value = codeCompareBaseMode;
  if (elements.codeCompareTargetSelect) elements.codeCompareTargetSelect.value = codeCompareTargetMode;
  renderCodeComparePanel();
  setStatus('비교 기준과 비교 대상을 서로 바꿨습니다.');
});
for (const button of elements.codeComparePresetButtons || []) {
  button?.addEventListener('click', () => {
    applyCodeComparePreset(button.dataset.codeComparePreset || 'draft-vs-current');
    setStatus('코드 비교 프리셋을 적용했습니다.');
  });
}
if (elements.codeEditorTextarea) {
  const syncCodeEditorUi = () => syncCodeWorkbenchState();
  elements.codeEditorTextarea.addEventListener('input', () => { codeEditorDirty = true; syncCodeFlowState(); syncCodeEditorUi(); });
  elements.codeEditorTextarea.addEventListener('click', syncCodeEditorUi);
  elements.codeEditorTextarea.addEventListener('keyup', syncCodeEditorUi);
  elements.codeEditorTextarea.addEventListener('select', syncCodeEditorUi);
}
elements.codeSearchNextButton?.addEventListener('click', searchCodeNext);
elements.codeSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchCodeNext(); }
});
elements.codeValidateButton?.addEventListener('click', () => {
  syncCodeWorkbenchState({ announce: true });
});
elements.codeJumpFirstChangeButton?.addEventListener('click', () => {
  if (!lastCodeDiffSummary.firstChangedLine) return setStatus('현재 보기 기준으로 변경된 줄이 없습니다.');
  jumpCodeEditorToLine(lastCodeDiffSummary.firstChangedLine, 1);
  setStatus(`첫 변경 줄(${lastCodeDiffSummary.firstChangedLine})로 이동했습니다.`);
});
elements.codeJumpTopButton?.addEventListener('click', () => {
  if (!elements.codeEditorTextarea) return;
  jumpCodeEditorToLine(1, 1);
  elements.codeEditorTextarea.scrollTop = 0;
  setStatus('코드 맨 위로 이동했습니다.');
});
elements.codeValidationList?.addEventListener('click', (event) => {
  const compareButton = event.target.closest?.('[data-code-open-compare]');
  if (compareButton) {
    const line = Number(compareButton.dataset.codeJumpLine || 1);
    const column = Number(compareButton.dataset.codeJumpColumn || 1);
    applyCodeComparePreset(compareButton.dataset.codeComparePreset || 'draft-vs-current');
    jumpCodeEditorToLine(line, column);
    setStatus(`검사 결과와 연결된 diff를 열고 ${line}줄로 이동했습니다.`);
    return;
  }
  const button = event.target.closest?.('[data-code-jump-line]');
  if (!button) return;
  const line = Number(button.dataset.codeJumpLine || 1);
  const column = Number(button.dataset.codeJumpColumn || 1);
  applyCodeComparePreset('draft-vs-current');
  jumpCodeEditorToLine(line, column);
  setStatus(`코드 ${line}줄로 이동했습니다. diff는 현재 초안 ↔ 현재 보기 기준으로 맞췄습니다.`);
});
elements.codeCompareList?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-code-compare-jump-source]');
  if (!button) return;
  const source = button.dataset.codeCompareJumpSource || 'draft';
  const line = Number(button.dataset.codeCompareJumpLine || 1);
  jumpToCodeCompareSource(source, line);
});
elements.marketLintList?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-code-jump-line]');
  if (!button) return;
  const line = Number(button.dataset.codeJumpLine || 1);
  const column = Number(button.dataset.codeJumpColumn || 1);
  openCodeWorkbench();
  jumpCodeEditorToLine(line, column);
  setStatus(`마켓 lint 관련 코드 ${line}줄로 이동했습니다.`);
});
elements.reloadCodeFromEditorButton?.addEventListener('click', () => { reloadCodeFromEditor().catch((error) => setStatus(`코드 다시 불러오기 오류: ${error?.message || error}`)); });
elements.applyCodeToEditorButton?.addEventListener('click', applyCodeToEditor);
elements.syncCodeFromCanvasQuickButton?.addEventListener('click', () => { reloadCodeFromEditor().catch((error) => setStatus(`코드 다시 불러오기 오류: ${error?.message || error}`)); openCodeWorkbench(); });

elements.safeApplyCodeButton?.addEventListener('click', safeApplyCodeToEditor);
elements.refreshStyleColorButton?.addEventListener('click', () => {
  renderStyleColorStudio(store.getState());
  setStatus('현재 편집본에서 스타일 색상 목록을 다시 읽었습니다.');
});
elements.styleColorScopeSelect?.addEventListener('change', () => {
  renderStyleColorStudio(store.getState());
  const scopeLabel = elements.styleColorScopeSelect?.value === 'selected-section' ? '선택 섹션' : '문서 전체';
  setStatus(`스타일 색상 편집 범위를 ${scopeLabel}로 바꿨습니다.`);
});
elements.styleColorList?.addEventListener('input', (event) => {
  const row = event.target?.closest?.('[data-style-color-key]');
  if (!row) return;
  const key = row.getAttribute('data-style-color-key') || '';
  const colorInput = row.querySelector('[data-style-color-input]');
  const textInput = row.querySelector('[data-style-color-text]');
  if (event.target === colorInput && textInput) textInput.value = colorInput.value;
  if (event.target === textInput && colorInput) colorInput.value = toColorInputValue(textInput.value);
  const item = lastStyleColorPalette.find((entry) => entry.key === key);
  const changed = !!item && String(textInput?.value || '').trim() && String(textInput?.value || '').trim().toLowerCase() !== String(item.displayValue || '').trim().toLowerCase();
  row.dataset.styleColorChanged = changed ? '1' : '0';
});
elements.styleColorList?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-style-color-reset]');
  if (!button) return;
  const key = button.getAttribute('data-style-color-reset') || '';
  const row = button.closest('[data-style-color-key]');
  const item = lastStyleColorPalette.find((entry) => entry.key === key);
  if (!row || !item) return;
  const colorInput = row.querySelector('[data-style-color-input]');
  const textInput = row.querySelector('[data-style-color-text]');
  if (textInput) textInput.value = item.displayValue;
  if (colorInput) colorInput.value = item.swatchValue;
  row.dataset.styleColorChanged = '0';
});
elements.applyStyleColorButton?.addEventListener('click', () => {
  const state = store.getState();
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || '';
  const scope = elements.styleColorScopeSelect?.value === 'selected-section' ? 'selected-section' : 'document';
  const sectionUid = getSelectedSectionUidForColorScope(state);
  if (scope === 'selected-section' && !sectionUid) return setStatus('선택 섹션 범위를 쓰려면 먼저 섹션 하나를 선택해 주세요.');
  const replacements = Array.from(document.querySelectorAll('[data-style-color-key]')).map((row) => {
    const key = row.getAttribute('data-style-color-key') || '';
    const input = row.querySelector('[data-style-color-text]');
    const value = String(input?.value || '').trim();
    const item = lastStyleColorPalette.find((entry) => entry.key === key);
    if (!key || !value || !item) return null;
    if (value.toLowerCase() === String(item.displayValue || '').trim().toLowerCase()) return null;
    return { key, value };
  }).filter(Boolean);
  if (!replacements.length) return setStatus('적용할 스타일 색상 변경이 없습니다.');
  const result = applyStyleColorGroupsToHtml(html, replacements, { scope, sectionUid, palette: lastStyleColorPalette });
  if (!result.changeCount) return setStatus('선택한 범위에서 실제로 바뀐 스타일 색상이 없습니다.');
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = result.html;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  safeApplyCodeToEditor();
  setStatus(`스타일 색상 ${replacements.length}개를 ${scope === 'selected-section' ? '선택 섹션' : '문서 전체'}에 적용했습니다.`);
});
elements.refreshCssTokenButton?.addEventListener('click', () => { renderCssTokenEditor(store.getState()); setStatus('현재 편집본에서 CSS 토큰을 다시 읽었습니다.'); });
elements.applyCssTokenButton?.addEventListener('click', () => {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(store.getState()) || '';
  let nextHtml = html;
  let applied = 0;
  for (const input of Array.from(document.querySelectorAll('[data-css-token-text]'))) {
    const name = input.getAttribute('data-css-token-text') || '';
    const value = String(input.value || '').trim();
    if (!name || !value) continue;
    const pattern = new RegExp(`(${escapeRegExp(name)}\\s*:\\s*)([^;}{]+)(\\s*;)`, 'g');
    const before = nextHtml;
    nextHtml = nextHtml.replace(pattern, `$1${value}$3`);
    if (nextHtml !== before) applied += 1;
  }
  if (!applied) return setStatus('적용할 CSS 토큰 변경이 없습니다.');
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = nextHtml;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  safeApplyCodeToEditor();
});
elements.refreshDesignTokenButton?.addEventListener('click', () => {
  renderDesignTokenEditor(store.getState());
  setStatus('현재 편집본에서 디자인 토큰을 다시 읽었습니다.');
});
elements.applyDesignTokenButton?.addEventListener('click', () => {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(store.getState()) || '';
  let nextHtml = html;
  let applied = 0;
  for (const input of Array.from(document.querySelectorAll('[data-design-token-text]'))) {
    const name = input.getAttribute('data-design-token-text') || '';
    const value = String(input.value || '').trim();
    if (!name || !value) continue;
    const pattern = new RegExp(`(${escapeRegExp(name)}\s*:\s*)([^;}{]+)(\s*;)`, 'g');
    const before = nextHtml;
    nextHtml = nextHtml.replace(pattern, `$1${value}$3`);
    if (nextHtml !== before) applied += 1;
  }
  if (!applied) return setStatus('적용할 typography/spacing/radius/shadow 토큰 변경이 없습니다.');
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = nextHtml;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  safeApplyCodeToEditor();
  setStatus(`디자인 토큰 ${applied}건을 적용했습니다.`);
});

elements.refreshInlineColorExtractButton?.addEventListener('click', () => {
  renderInlineColorExtractPanel(store.getState());
  setStatus('반복 inline 색상 후보를 다시 읽었습니다.');
});
elements.extractInlineColorVarsButton?.addEventListener('click', () => {
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(store.getState()) || '';
  const doc = parseHtmlToDocument(html);
  const styleEl = ensureGeneratedStyleBlock(doc, 'data-detail-editor-inline-vars');
  const rows = Array.from(document.querySelectorAll('[data-inline-color-key]'));
  const usedNames = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const key = row.getAttribute('data-inline-color-key') || '';
    const tokenInput = row.querySelector('[data-inline-color-token-name]');
    const candidate = lastInlineColorExtractCandidates.find((item) => item.key === key);
    const rawName = String(tokenInput?.value || candidate?.suggestedName || '').trim();
    if (!candidate || !rawName) return;
    let tokenName = rawName.startsWith('--') ? rawName : `--${slugify(rawName) || `inline-color-${index + 1}`}`;
    while (usedNames.has(tokenName)) tokenName = `${tokenName}-${usedNames.size + 1}`;
    usedNames.add(tokenName);
    entries.push({ name: tokenName, value: candidate.displayValue, variants: candidate.variants });
  });
  if (!entries.length) return setStatus('추출할 반복 inline 색상이 없습니다.');
  upsertCssVariablesIntoStyle(styleEl, entries);
  Array.from(doc.querySelectorAll('[style]')).forEach((element) => {
    let styleValue = String(element.getAttribute('style') || '');
    entries.forEach((entry) => {
      styleValue = replaceColorVariantsInText(styleValue, entry.variants, `var(${entry.name})`);
    });
    element.setAttribute('style', styleValue);
  });
  const nextHtml = serializeDocument(doc);
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = nextHtml;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  safeApplyCodeToEditor();
  setStatus(`반복 inline 색상 ${entries.length}개를 CSS 변수로 추출했습니다.`);
});

elements.refreshSectionThemeButton?.addEventListener('click', () => {
  renderSectionThemePalettes(store.getState());
  setStatus('섹션별 테마 팔레트를 다시 읽었습니다.');
});
elements.sectionThemePaletteList?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-section-theme-focus]');
  if (!button) return;
  const uid = button.getAttribute('data-section-theme-focus') || '';
  if (!uid) return;
  activeEditor?.selectNodeByUid?.(uid);
  setStatus('섹션을 선택했습니다.');
});
elements.sectionThemePaletteList?.addEventListener('input', (event) => {
  const row = event.target?.closest?.('[data-section-theme-key]');
  if (!row) return;
  const colorInput = row.querySelector('[data-section-theme-input]');
  const textInput = row.querySelector('[data-section-theme-text]');
  if (event.target === colorInput && textInput) textInput.value = colorInput.value;
  if (event.target === textInput && colorInput) colorInput.value = toColorInputValue(textInput.value);
});
elements.applySectionThemeButton?.addEventListener('click', () => {
  const state = store.getState();
  const sectionUid = getSelectedSectionUidForColorScope(state);
  if (!sectionUid) return setStatus('먼저 섹션 하나를 선택해 주세요.');
  const palette = lastSectionThemePalettes.find((item) => item.uid === sectionUid);
  if (!palette) return setStatus('선택 섹션 팔레트를 찾지 못했습니다.');
  const replacements = Array.from(document.querySelectorAll('[data-section-theme-key]')).map((row) => {
    const key = row.getAttribute('data-section-theme-key') || '';
    if (!key.startsWith(`${sectionUid}::`)) return null;
    const colorKey = key.split('::').slice(1).join('::');
    const input = row.querySelector('[data-section-theme-text]');
    const value = String(input?.value || '').trim();
    const item = palette.colors.find((entry) => entry.key === colorKey);
    if (!item || !value || value.toLowerCase() === String(item.displayValue || '').toLowerCase()) return null;
    return { key: colorKey, value };
  }).filter(Boolean);
  if (!replacements.length) return setStatus('적용할 섹션 팔레트 변경이 없습니다.');
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || '';
  const result = applyStyleColorGroupsToHtml(html, replacements, { scope: 'selected-section', sectionUid, palette: palette.colors });
  if (!result.changeCount) return setStatus('선택 섹션에서 실제로 바뀐 색상이 없습니다.');
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = result.html;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  safeApplyCodeToEditor();
  setStatus(`선택 섹션 팔레트 ${replacements.length}개를 적용했습니다.`);
});

elements.runContrastLintButton?.addEventListener('click', () => {
  renderContrastLintPanel(store.getState());
  setStatus('색상 대비 / 가독성 lint를 다시 검사했습니다.');
});
elements.contrastLintList?.addEventListener('click', (event) => {
  const focusButton = event.target.closest?.('[data-focus-node-uid]');
  if (focusButton) {
    const uid = focusButton.getAttribute('data-focus-node-uid') || '';
    if (uid) {
      activeEditor?.selectNodeByUid?.(uid);
      setStatus('가독성 이슈 요소를 선택했습니다.');
    }
    return;
  }
  const codeButton = event.target.closest?.('[data-code-jump-line]');
  if (codeButton) {
    jumpCodeEditorToLine(Number(codeButton.getAttribute('data-code-jump-line') || 1), Number(codeButton.getAttribute('data-code-jump-column') || 1));
    setStatus('가독성 lint 관련 코드 줄로 이동했습니다.');
  }
});
elements.codeCompareColorOnlyButton?.addEventListener('click', () => {
  codeCompareColorOnly = !codeCompareColorOnly;
  syncCodeCompareCompactControls();
  renderCodeComparePanel();
});

elements.themeStudioModeButtons?.forEach((button) => {
  button.addEventListener('click', () => setThemeStudioMode(button.dataset.themeStudioMode || 'colors'));
});
elements.themeStudioRefreshVisibleButton?.addEventListener('click', () => {
  refreshThemeStudioCurrentPane();
  setStatus('테마 스튜디오 항목을 다시 읽었습니다.');
});
elements.themeStudioRunChecksButton?.addEventListener('click', () => {
  setThemeStudioMode('lint');
  refreshThemeStudioCurrentPane();
  syncCodeWorkbenchState({ announce: false });
  setStatus('테마/마켓/대비 검사를 다시 실행했습니다.');
});
elements.themeStudioSafeApplyButton?.addEventListener('click', () => {
  setThemeStudioMode('apply');
  safeApplyCodeToEditor();
  syncThemeStudioHub(store.getState());
});
elements.themeStudioOpenCodeButton?.addEventListener('click', () => {
  openCodeWorkbench();
  syncThemeStudioHub(store.getState());
});
elements.themeStudioSyncCodeButton?.addEventListener('click', () => {
  reloadCodeFromEditor().catch((error) => setStatus(`코드 다시 불러오기 오류: ${error?.message || error}`));
  syncThemeStudioHub(store.getState());
});
elements.themeStudioApplyCodeButton?.addEventListener('click', () => {
  applyCodeToEditor();
  syncThemeStudioHub(store.getState());
});
elements.themeStudioApplyComparePresetButton?.addEventListener('click', () => {
  const preset = elements.themeStudioComparePresetSelect?.value || 'edited-vs-original';
  applyCodeComparePreset(preset);
  openCodeWorkbench();
  syncThemeStudioHub(store.getState());
});
elements.themeStudioIssuesOnlyButton?.addEventListener('click', () => {
  codeCompareIssuesOnly = !codeCompareIssuesOnly;
  syncCodeCompareCompactControls();
  renderCodeComparePanel();
  syncThemeStudioHub(store.getState());
});
elements.themeStudioColorDiffButton?.addEventListener('click', () => {
  codeCompareColorOnly = !codeCompareColorOnly;
  syncCodeCompareCompactControls();
  renderCodeComparePanel();
  syncThemeStudioHub(store.getState());
});

elements.generateSlotSchemaButton?.addEventListener('click', () => {
  const result = activeEditor?.autoGenerateSlotSchema?.();
  if (elements.slotSchemaSummary) elements.slotSchemaSummary.textContent = result?.message || '슬롯 schema 자동 생성 결과가 없습니다.';
  if (result?.message) setStatus(result.message);
});
elements.relinkBrokenAssetsButton?.addEventListener('click', () => elements.relinkAssetInput?.click());
elements.refreshBrokenAssetsButton?.addEventListener('click', () => { renderBrokenAssetPanel(store.getState().project); setStatus('미해결 자산 목록을 새로고침했습니다.'); });
elements.relinkAssetInput?.addEventListener('change', async (event) => {
  const files = Array.from(event.target?.files || []);
  if (!files.length) return;
  const state = store.getState();
  const unresolved = buildUnresolvedAssetItems(state.project);
  if (!unresolved.length) {
    event.target.value = '';
    return setStatus('현재 다시 연결할 미해결 자산이 없습니다.');
  }
  const html = elements.codeEditorTextarea?.value || getBestEditedHtml(state) || '';
  const fileMap = new Map();
  const projectKey = [state.project?.id || '', state.project?.sourceType || '', state.project?.sourceName || ''].join('::');
  for (const file of files) {
    try {
      const record = await registerRuntimeAsset(file, { projectKey });
      fileMap.set(filenameKey(file.name), buildRuntimeAssetRef(record.id, record.name));
    } catch {}
  }
  let nextHtml = html;
  let matched = 0;
  let unmatched = 0;
  for (const item of unresolved) {
    const key = filenameKey(item.ref);
    const replacement = fileMap.get(key);
    if (!replacement) { unmatched += 1; continue; }
    const before = nextHtml;
    nextHtml = nextHtml.split(item.ref).join(replacement);
    if (nextHtml !== before) matched += 1;
  }
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = nextHtml;
    codeEditorDirty = true;
    syncCodeWorkbenchState();
  }
  event.target.value = '';
  if (!matched) return setStatus(`파일명 기준으로 다시 연결된 자산이 없습니다. 미매칭 ${unmatched}개.`);
  safeApplyCodeToEditor();
  setStatus(`깨진 자산 경로 ${matched}개를 linked 자산으로 다시 연결했습니다. 미매칭 ${unmatched}개.`);
});
elements.runMarketLintButton?.addEventListener('click', () => {
  renderLintIssues(elements.marketLintList, buildMarketUploadLint(getBestEditedHtml(store.getState()), store.getState().project, store.getState().editorMeta));
  setStatus('마켓 업로드용 HTML lint를 다시 검사했습니다.');
});
elements.applySectionNoteButton?.addEventListener('click', () => {
  const state = store.getState();
  const selectedUids = getSectionPanelSelection(state.editorMeta);
  const uid = selectedUids[0] || state.editorMeta?.selectedSectionUid || '';
  const result = activeEditor?.setSectionNoteByUid?.(uid, elements.sectionNoteInput?.value || '');
  if (result?.message) setStatus(result.message);
});
elements.clearSectionNoteButton?.addEventListener('click', () => {
  const state = store.getState();
  const selectedUids = getSectionPanelSelection(state.editorMeta);
  const uid = selectedUids[0] || state.editorMeta?.selectedSectionUid || '';
  const result = activeEditor?.setSectionNoteByUid?.(uid, '');
  if (elements.sectionNoteInput) elements.sectionNoteInput.value = '';
  if (result?.message) setStatus(result.message);
});
elements.applyCodeFromPanelButton?.addEventListener('click', () => { openCodeWorkbench(); applyCodeToEditor(); });
elements.openCodeWorkbenchButton?.addEventListener('click', () => openCodeWorkbench());
elements.toggleImageLockButton?.addEventListener('click', () => {
  const result = executeEditorCommand('toggle-image-lock');
  if (result?.message) setStatus(result.message);
});
elements.inspectorReplaceImageButton?.addEventListener('click', () => {
  elements.replaceImageButton?.click();
});
elements.inspectorCropModeButton?.addEventListener('click', () => {
  const cropActive = !!store.getState().editorMeta?.cropActive;
  const result = executeCanvasContextAction(cropActive ? 'image-crop-apply' : 'image-crop-enter');
  if (result?.message) setStatus(result.message);
});
elements.inspectorRemoveImageButton?.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.removeImageFromSelected();
  if (result?.message) setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
const inspectorPresetMap = [
  [elements.inspectorPresetCoverButton, 'cover'],
  [elements.inspectorPresetContainButton, 'contain'],
  [elements.inspectorPresetTopButton, 'top'],
  [elements.inspectorPresetCenterButton, 'center'],
  [elements.inspectorPresetBottomButton, 'bottom'],
];
for (const [button, preset] of inspectorPresetMap) {
  button?.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.applyImagePreset(preset);
    if (result?.message) setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}
elements.inspectorImageLockButton?.addEventListener('click', () => {
  const result = executeEditorCommand('toggle-image-lock');
  if (result?.message) setStatus(result.message);
});
elements.inspectorRedetectButton?.addEventListener('click', () => {
  elements.redetectButton?.click();
});
const inspectorNudgeMap = [
  [elements.inspectorImageNudgeLeftButton, { dx: -2, dy: 0 }],
  [elements.inspectorImageNudgeRightButton, { dx: 2, dy: 0 }],
  [elements.inspectorImageNudgeUpButton, { dx: 0, dy: -2 }],
  [elements.inspectorImageNudgeDownButton, { dx: 0, dy: 2 }],
];
for (const [button, offset] of inspectorNudgeMap) {
  button?.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.nudgeSelectedImage(offset);
    if (result?.message) setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}
elements.toggleLeftSidebarButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--left-collapsed');
  document.body.classList.remove('layout--focus-stage');
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.toggleRightSidebarButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--right-collapsed');
  document.body.classList.remove('layout--focus-stage');
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.focusModeButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--focus-stage');
  if (document.body.classList.contains('layout--focus-stage')) {
    document.body.classList.add('layout--left-collapsed', 'layout--right-collapsed');
  }
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.zoomOutButton?.addEventListener('click', () => nudgeZoom(-0.1));
elements.zoomInButton?.addEventListener('click', () => nudgeZoom(0.1));
elements.zoomResetButton?.addEventListener('click', () => setZoom('manual', 1));
elements.zoomFitButton?.addEventListener('click', () => setZoom('fit'));
window.addEventListener('resize', applyPreviewZoom);
elements.basicAttributeSection?.addEventListener('toggle', persistPanelLayoutState);
elements.advancedAttributeSection?.addEventListener('toggle', persistPanelLayoutState);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.commandPaletteOverlay?.hidden) {
    event.preventDefault();
    toggleCommandPalette(false);
    return;
  }
  handleCommandPaletteFocusTrap(event);
  if (!elements.commandPaletteOverlay?.hidden) return;

  if (event.key === 'Escape' && !elements.downloadModal?.hidden) {
    event.preventDefault();
    toggleDownloadModal(false);
    return;
  }
  handleDownloadModalFocusTrap(event);
  if (!elements.downloadModal?.hidden) return;

  if (event.key === 'Escape' && !elements.shortcutHelpOverlay?.hidden) {
    event.preventDefault();
    toggleShortcutHelp(false);
    return;
  }
  const questionMarkPressed = event.key === '?' || (event.key === '/' && event.shiftKey);
  if (questionMarkPressed) {
    if (isTypingInputTarget(event.target)) return;
    event.preventDefault();
    toggleShortcutHelp();
    return;
  }
  if (!elements.shortcutHelpOverlay?.hidden && event.key === 'Tab') {
    const focusable = Array.from(elements.shortcutHelpOverlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter((node) => node instanceof HTMLElement && !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true');
    if (focusable.length < 1) {
      event.preventDefault();
      elements.shortcutHelpCloseButton?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
      return;
    }
  }
  if (!elements.shortcutHelpOverlay?.hidden) return;

  const withModifier = event.ctrlKey || event.metaKey;
  if (!withModifier && !isTypingInputTarget(event.target)) {
    const key = String(event.key || '').toLowerCase();
    if (event.code === 'Space') {
      event.preventDefault();
      previewSpacePanArmed = true;
      elements.previewViewport?.classList.add('is-space-pan');
      return;
    }
    if (key === 'pageup') {
      event.preventDefault();
      if (!jumpSectionByOffset(-1)) scrollPreviewByPage(-1);
      return;
    }
    if (key === 'pagedown') {
      event.preventDefault();
      if (!jumpSectionByOffset(1)) scrollPreviewByPage(1);
      return;
    }
    if (key === 'home') {
      event.preventDefault();
      scrollPreviewToEdge('top');
      return;
    }
    if (key === 'end') {
      event.preventDefault();
      scrollPreviewToEdge('bottom');
      return;
    }
    if (key === 'v') {
      event.preventDefault();
      return performCommandAction('tool-select');
    }
    if (key === 't') {
      event.preventDefault();
      return performCommandAction('tool-text');
    }
    if (key === 'r') {
      event.preventDefault();
      return performCommandAction('tool-box');
    }
  }

  if (!withModifier && event.altKey && !isTypingInputTarget(event.target)) {
    if (key === 'arrowup') {
      event.preventDefault();
      const result = applySectionAction('move-up', '', { fromMenu: false });
      if (result?.message) setStatus(result.message);
      return;
    }
    if (key === 'arrowdown') {
      event.preventDefault();
      const result = applySectionAction('move-down', '', { fromMenu: false });
      if (result?.message) setStatus(result.message);
      return;
    }
  }
  if (!withModifier || event.altKey) return;
  const key = String(event.key || '').toLowerCase();
  if (key === 'k') {
    event.preventDefault();
    toggleCommandPalette(true);
    return;
  }
  if (key === 'e' && event.shiftKey) {
    event.preventDefault();
    reloadCodeFromEditor().catch((error) => setStatus(`코드 다시 불러오기 오류: ${error?.message || error}`));
    openCodeWorkbench();
    return;
  }
  if (isTypingInputTarget(event.target)) return;
  if (key === 'd') {
    event.preventDefault();
    return performCommandAction('duplicate');
  }
  if (key === 'g') {
    event.preventDefault();
    return performCommandAction(event.shiftKey ? 'ungroup' : 'group');
  }
  if (key === 'z') {
    event.preventDefault();
    return event.shiftKey ? redoHistory() : undoHistory();
  }
  if (key === 'y') {
    event.preventDefault();
    return redoHistory();
  }
  if (key === 's') {
    event.preventDefault();
    return performCommandAction('save-edited');
  }
  if (key === '=') {
    event.preventDefault();
    return nudgeZoom(0.1);
  }
  if (key === '-') {
    event.preventDefault();
    return nudgeZoom(-0.1);
  }
  if (key === '0') {
    event.preventDefault();
    return setZoom('fit');
  }
  if (key === '[') {
    event.preventDefault();
    return executeEditorCommand(event.shiftKey ? 'layer-index-back' : 'layer-index-backward');
  }
  if (key === ']') {
    event.preventDefault();
    return executeEditorCommand(event.shiftKey ? 'layer-index-front' : 'layer-index-forward');
  }
  if (key === 'l' && event.shiftKey) {
    event.preventDefault();
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.toggleSelectedLocked();
    return setStatus(result?.message || '잠금을 전환했습니다.');
  }
  if (key === 'b') {
    event.preventDefault();
    document.body.classList.toggle('layout--left-collapsed');
    syncWorkspaceButtons();
    return applyPreviewZoom();
  }
  if (key === 'i') {
    event.preventDefault();
    document.body.classList.toggle('layout--right-collapsed');
    syncWorkspaceButtons();
    return applyPreviewZoom();
  }
  if (key === 'f') {
    event.preventDefault();
    return setZoom('fit');
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    previewSpacePanArmed = false;
    elements.previewViewport?.classList.remove('is-space-pan');
  }
});

elements.shortcutHelpOverlay?.addEventListener('click', (event) => {
  if (event.target === elements.shortcutHelpOverlay) toggleShortcutHelp(false);
});
elements.shortcutHelpCloseButton?.addEventListener('click', () => toggleShortcutHelp(false));
elements.commandPaletteOverlay?.addEventListener('click', (event) => {
  if (event.target === elements.commandPaletteOverlay) toggleCommandPalette(false);
});
elements.downloadModal?.addEventListener('click', (event) => {
  if (event.target === elements.downloadModal) toggleDownloadModal(false);
});
elements.beginnerModeToggle?.addEventListener('click', () => setBeginnerMode(!isBeginnerMode));
elements.beginnerTutorialPrevButton?.addEventListener('click', () => {
  beginnerTutorialStepIndex = Math.max(0, beginnerTutorialStepIndex - 1);
  renderBeginnerTutorialStep();
});
elements.beginnerTutorialNextButton?.addEventListener('click', () => {
  if (beginnerTutorialStepIndex >= BEGINNER_TUTORIAL_STEPS.length - 1) {
    completeOnboardingTutorial();
    return;
  }
  beginnerTutorialStepIndex += 1;
  renderBeginnerTutorialStep();
});
elements.beginnerTutorialCloseButton?.addEventListener('click', () => {
  closeBeginnerTutorial();
  setStatus('온보딩을 건너뛰었습니다. 언제든 [온보딩 다시보기] 버튼으로 재시작할 수 있어요.');
});
elements.onboardingReplayButton?.addEventListener('click', () => {
  openBeginnerTutorial({ force: true });
  setStatus('온보딩을 다시 시작했습니다.');
});
elements.onboardingChecklistDoneButton?.addEventListener('click', () => {
  writeToLocalStorage(ONBOARDING_SAMPLE_CHECKED_STORAGE_KEY, '1');
  renderOnboardingChecklist();
  setStatus('샘플 작업 1회 실행 체크리스트를 완료로 기록했습니다.');
});
elements.cropZoomSlider?.addEventListener('input', (event) => {
  if (!activeEditor) return;
  const nextZoom = Math.max(0.35, Math.min(5, (Number(event.target.value || 100) || 100) / 100));
  const result = activeEditor.setImageCropZoom?.(nextZoom);
  if (result?.message) setStatus(result.message);
});
elements.cropPresetFitButton?.addEventListener('click', () => {
  const result = activeEditor?.applyImageCropViewPreset?.('fit');
  if (result?.message) setStatus(result.message);
});
elements.cropPresetCoverButton?.addEventListener('click', () => {
  const result = activeEditor?.applyImageCropViewPreset?.('cover');
  if (result?.message) setStatus(result.message);
});
elements.cropPresetActualButton?.addEventListener('click', () => {
  const result = activeEditor?.applyImageCropViewPreset?.('actual');
  if (result?.message) setStatus(result.message);
});
elements.cropPresetResetButton?.addEventListener('click', () => {
  const result = activeEditor?.applyImageCropViewPreset?.('reset');
  if (result?.message) setStatus(result.message);
});
elements.previewMinimapTrack?.addEventListener('click', (event) => {
  const marker = event.target.closest?.('[data-minimap-section-uid]');
  if (marker) {
    const uid = marker.getAttribute('data-minimap-section-uid') || '';
    if (!uid) return;
    setSectionPanelSelection([uid], { anchorUid: uid, syncEditor: true, scroll: true, silent: true });
    scrollToSectionUid(uid, { behavior: 'smooth' });
    setStatus('미니맵에서 섹션으로 이동했습니다.');
    return;
  }
  const viewport = elements.previewViewport;
  const track = elements.previewMinimapTrack;
  if (!viewport || !track) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
  const target = Math.max(0, ratio * viewport.scrollHeight - viewport.clientHeight / 2);
  viewport.scrollTo({ top: target, behavior: 'smooth' });
  schedulePreviewMinimapSync();
});
elements.settingsSnapToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('snap', '스냅'));
elements.settingsGuideToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('guide', '가이드'));
elements.settingsRulerToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('ruler', '눈금자'));
elements.settingsShortcutHelpButton?.addEventListener('click', () => toggleShortcutHelp(true));
document.addEventListener('click', (event) => {
  const quickbar = elements.canvasQuickbarMore;
  if (!quickbar || quickbar.hidden) return;
  if (quickbar.contains(event.target)) return;
  quickbar.removeAttribute('open');
});
elements.settingsBeginnerModeButton?.addEventListener('click', () => setBeginnerMode(!isBeginnerMode));
elements.viewSnapToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('snap', '스냅'));
elements.viewGuideToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('guide', '가이드'));
elements.viewRulerToggleButton?.addEventListener('click', () => toggleViewFeatureFlag('ruler', '눈금자'));
}

bindEvents();

for (const guideContainer of document.querySelectorAll('[data-left-tab-guide-for]')) {
  renderLeftTabStepGuide(guideContainer, guideContainer.getAttribute('data-left-tab-guide-for') || '');
}
setSidebarTab('left-start');
setCodeSource('edited', { preserveDraft: false });
syncSaveFormatUi();
restorePanelLayoutState();
syncAdvancedFormFromState();
syncViewFeatureButtons();
syncWorkspaceButtons();
applyShortcutTooltips();
currentSectionThumbnailPreset = normalizeSectionThumbnailPreset(readFromLocalStorage(SECTION_THUMBNAIL_PRESET_STORAGE_KEY, 'auto'));

for (const tabButton of elements.sidebarTabButtons || []) {
  const label = tabButton.querySelector('.sidebar-tab__label')?.textContent?.trim();
  if (label && !tabButton.getAttribute('title')) tabButton.setAttribute('title', label);
}
if (elements.sectionThumbnailPresetSelect) elements.sectionThumbnailPresetSelect.value = currentSectionThumbnailPreset;
syncCodeCompareCompactControls();
setBeginnerMode(readFromLocalStorage(BEGINNER_MODE_STORAGE_KEY, '0') === '1', { silent: true });
openBeginnerTutorialIfNeeded();

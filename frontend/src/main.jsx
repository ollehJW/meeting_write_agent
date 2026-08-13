import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import QRCode from 'qrcode';
import { AlertTriangle, BarChart3, Building2, CalendarDays, CheckCircle2, Clock3, Download, Eye, EyeOff, FileText, GripVertical, Home, Info, KeyRound, Tags, LogIn, LogOut, Mic2, Pause, Pencil, Play, Plus, Settings, ShieldCheck, Square, Trash2, Trophy, UploadCloud, UserRound, UserPlus, X } from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const RECORD_BAR_COUNT = 28;
const USER_GUIDE_MARKDOWN = `# 사용 가이드

## 1. 과제 카테고리 관리

회의록은 반드시 하나의 과제 카테고리에 저장됩니다. 먼저 **설정 > 카테고리 관리**에서 과제명을 등록해두면 회의록 생성 시 카테고리를 선택할 수 있습니다.

- 새 과제는 카테고리명 입력 후 추가합니다.
- 드래그로 카테고리 순서를 바꿀 수 있습니다.
- 사용하지 않는 카테고리는 삭제할 수 있지만, 이미 저장된 회의록 분류 기준과 연결될 수 있으니 신중히 관리합니다.

## 2. Confluence 연동

**설정 > Confluence 관리**에서 회의록을 저장할 Confluence 상위 페이지와 Access Token을 연결합니다.

Access Token은 Confluence에서 아래 경로로 발급할 수 있습니다.

1. 프로필
2. 환경설정
3. 개인용 엑세스 토큰
4. 토큰 만들기

발급한 Access Token과 회의록 저장 페이지 URL을 입력한 뒤 **연결 테스트**를 실행하면 연동 상태가 저장됩니다. 저장된 Access Token은 서버 DB에 암호화되어 보관됩니다.

## 3. 회의 녹음

**회의 녹음** 메뉴에서 현재 접속한 컴퓨터의 마이크로 바로 녹음할 수 있습니다.

- 녹음 시작 후 일시정지, 재개, 종료가 가능합니다.
- 녹음이 끝나면 브라우저가 만든 원본 오디오 파일이 생성됩니다.
- **녹음 보관**을 누르면 제목을 입력해 녹음을 서버에 보관할 수 있으며, 보관된 녹음은 7일 간 유지됩니다.
- **회의록 생성으로 이동**을 누르면 녹음이 기본 제목으로 자동 보관된 뒤 생성 화면에 연결됩니다. 이미 보관 완료된 녹음은 중복 보관하지 않습니다.
- 회의록 생성 화면의 **보관 녹음 불러오기**에서 보관된 녹음을 미리 재생해보고 회의 녹음 파일로 연결할 수 있습니다.
- PC 화면에서는 **다운로드**로 녹음 파일을 저장할 수 있으며, 모바일 화면은 보안 정책에 따라 녹음 파일 다운로드를 제공하지 않습니다.

## 4. 회의록 생성 프로세스

회의록 생성은 업로드된 오디오와 입력한 회의 정보를 기준으로 순차 실행됩니다.

### 자동 처리 단계

1. 오디오 분석
2. 화자 분리
3. 화자 구간 전처리
4. STT 전환
5. 문맥 기반 교정
6. 화자 자동 매칭

### 사용자가 입력해야 하는 정보

회의록 생성을 시작하기 전에 아래 항목을 입력하거나 선택해야 합니다.

- 회의 제목
- 과제 카테고리
- 회의 목적
- 회의 날짜와 시작/종료 시간
- 주관 부서 또는 조직
- 참석자
- 회의 녹음 파일
- 참고자료와 추가 참고 내용은 선택 입력입니다.

### 사용자가 확인하거나 수정해야 하는 정보

자동 처리가 끝나면 시스템이 추정한 결과를 그대로 확정하지 말고, 아래 항목을 확인합니다.

- 화자 자동 매칭 결과가 실제 참석자와 맞는지 확인합니다.
- 잘못 매칭된 화자는 직접 올바른 참석자로 변경합니다.
- STT 결과에서 틀린 문장, 누락된 표현, 잘못 인식된 용어가 있으면 발화 내용을 수정합니다.
- 화자명이 잘못 붙은 문장은 올바른 화자로 바꿉니다.
- 회의록 작성 전에 특별히 반영할 작성 지시사항이 있으면 입력합니다.
- 생성된 회의록 초안을 마지막으로 검토한 뒤 확정 저장합니다.

확정 저장된 회의록은 회의록 라운지에 보관되며, 이후 다시 열람하거나 다운로드할 수 있습니다.

## 5. 회의록 라운지 활용법

**회의록 라운지**는 확정 저장된 회의록을 다시 찾고 검토하는 공간입니다.

- 카테고리와 월 기준으로 회의록을 필터링할 수 있습니다.
- 회의록 상세를 열어 최종 마크다운 내용을 확인할 수 있습니다.
- 저장된 원본 오디오가 있으면 라운지에서 함께 재생할 수 있습니다.
- 필요 시 회의록 본문이나 참고자료를 다운로드해 공유합니다.
`;

function normalizeSpeakerId(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const numericValue = Number(text);
  return Number.isFinite(numericValue) && text !== '' ? String(numericValue) : text;
}

function speakerIdsFromResult(result) {
  const ids = new Set(
    (result?.sentences || [])
      .map((sentence) => normalizeSpeakerId(sentence.speaker_id ?? sentence.speaker))
      .filter(Boolean),
  );
  return Array.from(ids).sort((a, b) => {
    const numberA = Number(a);
    const numberB = Number(b);
    if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB;
    return a.localeCompare(b);
  });
}

function matchBySpeaker(matchesData, speakerId) {
  return (matchesData?.matches || []).find((match) => Number(match.speaker_id) === Number(speakerId));
}

async function apiError(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  return new Error(data.detail || fallbackMessage);
}


function displayConfluenceUrl(value) {
  const text = String(value || '');
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

function MarkdownReport({ markdown }) {
  return (
    <article className="markdown-report">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || ''}</ReactMarkdown>
    </article>
  );
}



function getMobileViewFromPath(pathname = window.location.pathname) {
  const segment = pathname.split('/').filter(Boolean)[1] || 'home';
  return ['home', 'record', 'create', 'lounge'].includes(segment) ? segment : 'home';
}

function MobileBottomNav({ current, onNavigate }) {
  const items = [
    { id: 'home', label: '홈', icon: Home },
    { id: 'record', label: '녹음', icon: Mic2 },
    { id: 'create', label: '작성', icon: FileText },
    { id: 'lounge', label: '라운지', icon: Tags },
  ];
  return (
    <nav className="mobile-bottom-nav" aria-label="모바일 페이지 이동">
      {items.map(({ id, label, icon: Icon }) => (
        <button className={current === id ? 'active' : ''} type="button" key={id} onClick={() => onNavigate(id)}>
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function detectMobilePlatform() {
  if (typeof window === 'undefined') return 'other';
  const ua = navigator.userAgent || navigator.vendor || '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

function isPwaStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function MobilePageHeader({ kicker, title, description, action }) {
  return (
    <header className="mobile-page-head">
      <div>
        <span>{kicker}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

function MobileLoginPage({
  loginUsername,
  setLoginUsername,
  loginPassword,
  setLoginPassword,
  loginError,
  isLoggingIn,
  onLogin,
  installPromptReady,
  isStandalone,
  mobilePlatform,
  onInstallApp,
}) {
  return (
    <main className="mobile-login-shell">
      <section className="mobile-login-brand">
        <span className="wia-mark mobile-wia-mark">WIA</span>
        <div>
          <b>WIAMeet</b>
          <p>회의 녹음과 회의록 자동 작성을 모바일에서 바로 시작하세요.</p>
        </div>
      </section>

      <form className="mobile-login-card" onSubmit={onLogin}>
        <div className="mobile-login-head">
          <span>Account Login</span>
          <h1>로그인</h1>
        </div>
        <label className="mobile-field">
          <span>아이디</span>
          <input
            type="text"
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            autoComplete="username"
            placeholder="아이디를 입력하세요"
          />
        </label>
        <label className="mobile-field">
          <span>비밀번호</span>
          <input
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="비밀번호를 입력하세요"
          />
        </label>
        {loginError && <div className="mobile-error-box">{loginError}</div>}
        <button className="mobile-primary-action dark" type="submit" disabled={isLoggingIn}>
          {isLoggingIn ? <span className="btn-spinner" aria-hidden="true"></span> : <LogIn size={18} />}
          {isLoggingIn ? '로그인 중' : '로그인'}
        </button>
      </form>

      <section className="mobile-login-install-card">
        <div className="mobile-install-icon"><Download size={20} /></div>
        <div>
          <span>Mobile App</span>
          <b>{isStandalone ? '앱으로 실행 중입니다.' : 'WIAMeet 앱 설치'}</b>
          <p>{isStandalone ? '홈 화면 아이콘으로 실행된 상태입니다.' : mobilePlatform === 'ios' ? 'Safari 공유 버튼에서 홈 화면에 추가를 선택하세요.' : '홈 화면에 설치하면 앱처럼 바로 실행할 수 있습니다.'}</p>
        </div>
        {!isStandalone && (
          <button className="mobile-install-button" type="button" onClick={onInstallApp}>
            {mobilePlatform === 'ios' ? '설치 방법' : installPromptReady ? '앱 설치' : '설치 안내'}
          </button>
        )}
      </section>
    </main>
  );
}

function MobileMeetHome({ authUser, homeStats, onLogout, onOpenDesktop, onNavigate }) {
  const recentReports = homeStats.recentReports.slice(0, 3);
  return (
    <>
      <header className="mobile-meet-topbar">
        <div className="mobile-brand-lockup">
          <span className="wia-mark mobile-wia-mark">WIA</span>
          <div>
            <b>WIAMeet</b>
            <span>Mobile</span>
          </div>
        </div>
        <button className="mobile-icon-btn" type="button" onClick={onLogout} aria-label="로그아웃">
          <LogOut size={18} />
        </button>
      </header>

      <section className="mobile-hero-card">
        <span className="mobile-kicker">Meet Home</span>
        <h1>{authUser.display_name || authUser.username}님, 안녕하세요.</h1>
        <p>휴대폰에서는 회의 녹음, 파일 업로드, 회의록 확인 흐름을 빠르게 사용할 수 있습니다.</p>
        <div className="mobile-hero-actions">
          <button className="mobile-primary-action" type="button" onClick={() => onNavigate('create')}>
            <FileText size={18} />
            회의록 작성
          </button>
          <button className="mobile-secondary-action" type="button" onClick={onOpenDesktop}>
            <FileText size={18} />
            PC 화면 열기
          </button>
        </div>
      </section>

      <section className="mobile-summary-grid" aria-label="회의록 요약">
        <div className="mobile-summary-card primary">
          <FileText size={18} />
          <span>전체 회의록</span>
          <b>{homeStats.totalReports}</b>
        </div>
        <div className="mobile-summary-card">
          <CalendarDays size={18} />
          <span>지난주 회의</span>
          <b>{homeStats.lastWeekCount}</b>
          <small>{homeStats.lastWeekRange}</small>
        </div>
        <div className="mobile-summary-card wide">
          <Trophy size={18} />
          <span>지난 주 우리팀의 회의 부자</span>
          <b>{homeStats.topParticipant?.name || '-'}</b>
          <small>{homeStats.topParticipant ? `${homeStats.topParticipant.count}회 참석` : '지난주 참석 기록이 없습니다.'}</small>
        </div>
      </section>

      <section className="mobile-panel">
        <div className="mobile-panel-head">
          <div>
            <span>Recent</span>
            <h2>최근 회의록</h2>
          </div>
          <small>최근 3건</small>
        </div>
        <div className="mobile-recent-list">
          {recentReports.map((report) => (
            <article className="mobile-recent-card" key={report.report_uuid}>
              <b>{report.title}</b>
              <span>{report.category_name || '카테고리 미지정'} · 참가 {(report.participants || []).length}명</span>
              <small>{report.meeting_date || '-'} · {report.start_time || '--:--'}</small>
            </article>
          ))}
          {recentReports.length === 0 && <div className="mobile-empty-card">최근 회의록이 없습니다.</div>}
        </div>
      </section>
    </>
  );
}

function MobileRecordPage({
  recorderSupported,
  recordingStatus,
  recordingStatusLabel,
  recordingSeconds,
  recordingBars,
  recordingError,
  audioFile,
  audioUrl,
  onStart,
  onPauseResume,
  onStop,
  onClear,
  onUseForCreate,
  onArchive,
  archiveSaved,
  isArchiving,
  archiveMessage,
  archiveError,
}) {
  const duration = formatRecordingDuration(recordingSeconds);
  return (
    <>
      <MobilePageHeader
        kicker="Mobile Recorder"
        title="회의 녹음"
        description="휴대폰 마이크로 회의를 녹음하고, 녹음 파일을 회의록 생성에 바로 연결합니다."
      />
      <section className={`mobile-record-card ${recordingStatus === 'recording' ? 'active' : ''}`}>
        <div className="mobile-record-status">
          <span className={`record-status-dot ${recordingStatus}`}>{recordingStatus === 'recording' && <span />}</span>
          <b>{recordingStatusLabel}</b>
        </div>
        <div className="mobile-record-timer">
          <span>{duration.minutes}</span>
          <i>:</i>
          <span>{duration.seconds}</span>
        </div>
        <div className={`record-waveform mobile-waveform ${recordingStatus === 'recording' ? 'active' : ''}`}>
          {recordingBars.map((height, index) => (
            <i key={index} style={{ height: recordingStatus === 'recording' ? `${height}px` : '7px', opacity: recordingStatus === 'recording' ? 0.55 + (height / 40) * 0.45 : 1 }} />
          ))}
        </div>
        <div className="mobile-record-actions">
          {recordingStatus === 'idle' && (
            <button className="mobile-primary-action dark" type="button" onClick={onStart} disabled={!recorderSupported}>
              <Mic2 size={18} />녹음 시작
            </button>
          )}
          {(recordingStatus === 'recording' || recordingStatus === 'paused') && (
            <>
              <button className="mobile-secondary-action light" type="button" onClick={onPauseResume}>
                {recordingStatus === 'recording' ? <Pause size={18} /> : <Play size={18} />}
                {recordingStatus === 'recording' ? '일시정지' : '재개'}
              </button>
              <button className="mobile-primary-action danger" type="button" onClick={onStop}>
                <Square size={18} />종료
              </button>
            </>
          )}
          {recordingStatus === 'stopped' && (
            <button className="mobile-primary-action dark" type="button" onClick={onStart}>
              <Mic2 size={18} />다시 녹음
            </button>
          )}
        </div>
      </section>
      {recordingError && <div className="mobile-error-box">{recordingError}</div>}
      {!recorderSupported && <div className="mobile-error-box">현재 브라우저가 마이크 녹음을 지원하지 않습니다.</div>}
      {audioFile && (
        <section className="mobile-panel">
          <div className="mobile-panel-head">
            <div>
              <span>Saved Audio</span>
              <h2>녹음 파일</h2>
            </div>
          </div>
          <div className="mobile-audio-file">
            <b>{audioFile.name}</b>
            <span>모바일 보안 정책에 따라 녹음 파일 다운로드는 제공하지 않습니다.</span>
          </div>
          <audio className="mobile-audio-player" src={audioUrl} controls preload="metadata" />
          <div className="mobile-stack-actions">
            <button className="mobile-primary-action dark" type="button" onClick={onUseForCreate} disabled={isArchiving}>
              {isArchiving ? <span className="btn-spinner" aria-hidden="true"></span> : <FileText size={18} />}
              {isArchiving ? '녹음 보관 중' : '회의록 작성으로 이동'}
            </button>
            <button className="mobile-secondary-action bordered" type="button" onClick={onArchive} disabled={archiveSaved || isArchiving}>
              <CheckCircle2 size={18} />{archiveSaved ? '보관 완료' : '녹음 보관'}
            </button>
            <button className="mobile-secondary-action bordered danger-text" type="button" onClick={onClear}><Trash2 size={18} />삭제</button>
          </div>
          {archiveMessage && <div className="mobile-info-box">{archiveMessage}</div>}
          {archiveError && <div className="mobile-error-box">{archiveError}</div>}
        </section>
      )}
    </>
  );
}

function MobileCreatePage({
  categories,
  selectedCategoryUuid,
  setSelectedCategoryUuid,
  meetingTitle,
  setMeetingTitle,
  meetingDate,
  setMeetingDate,
  meetingStartTime,
  setMeetingStartTime,
  meetingEndTime,
  setMeetingEndTime,
  meetingPurpose,
  setMeetingPurpose,
  meetingOrganizations,
  setMeetingOrganizations,
  members,
  participants,
  setParticipants,
  audioFile,
  referenceFiles,
  setReferenceFiles,
  job,
  error,
  canStart,
  onUploadAndRun,
  onOpenRecorder,
  onOpenDraftPicker,
  onUnlinkAudio,
}) {
  const [organizationText, setOrganizationText] = useState('');
  const [participantText, setParticipantText] = useState('');
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const addValue = (value, setter, clear) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setter((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    clear('');
  };
  const teamMembers = members
    .map((member) => member.member_name?.trim())
    .filter(Boolean);
  const availableTeamMembers = teamMembers.filter((memberName) => !participants.includes(memberName));
  const addTeamMember = (memberName) => {
    setParticipants((prev) => (prev.includes(memberName) ? prev : [...prev, memberName]));
  };
  const addAllTeamMembers = () => {
    setParticipants((prev) => {
      const existing = new Set(prev);
      const nextMembers = teamMembers.filter((memberName) => !existing.has(memberName));
      return nextMembers.length ? [...prev, ...nextMembers] : prev;
    });
  };
  return (
    <>
      <MobilePageHeader
        kicker="Create Report"
        title="회의록 생성"
        description="모바일에서는 핵심 정보와 녹음 파일을 빠르게 등록하는 흐름으로 구성했습니다."
      />
      <section className="mobile-form-card">
        <label className="mobile-field">
          <span>회의 제목</span>
          <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="회의 제목 입력" />
        </label>
        <label className="mobile-field">
          <span>카테고리</span>
          <select value={selectedCategoryUuid} onChange={(event) => setSelectedCategoryUuid(event.target.value)}>
            <option value="">카테고리 선택</option>
            {categories.map((category) => <option value={category.category_uuid} key={category.category_uuid}>{category.category_name}</option>)}
          </select>
        </label>
        <label className="mobile-field">
          <span>회의 목적</span>
          <textarea value={meetingPurpose} onChange={(event) => setMeetingPurpose(event.target.value)} placeholder="회의 목적 입력" rows={3} />
        </label>
        <div className="mobile-two-fields">
          <label className="mobile-field">
            <span>회의 날짜</span>
            <input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
          </label>
          <div className="mobile-time-pair">
            <label className="mobile-field">
              <span>시작 시간</span>
              <input type="time" value={meetingStartTime} onChange={(event) => setMeetingStartTime(event.target.value)} />
            </label>
            <label className="mobile-field">
              <span>종료 시간</span>
              <input type="time" value={meetingEndTime} onChange={(event) => setMeetingEndTime(event.target.value)} />
            </label>
          </div>
        </div>
        <div className="mobile-chip-editor">
          <span>참석 조직</span>
          <div className="mobile-inline-add">
            <input value={organizationText} onChange={(event) => setOrganizationText(event.target.value)} placeholder="조직 입력" />
            <button type="button" onClick={() => addValue(organizationText, setMeetingOrganizations, setOrganizationText)}><Plus size={16} /></button>
          </div>
          <div className="mobile-chip-list">
            {meetingOrganizations.map((item, index) => <button type="button" key={`${item}-${index}`} onClick={() => setMeetingOrganizations((prev) => prev.filter((_, i) => i !== index))}>{item}<X size={13} /></button>)}
          </div>
        </div>
        <div className="mobile-chip-editor">
          <div className="mobile-chip-title-row">
            <span>참석자</span>
            <button className="mobile-team-open-btn" type="button" onClick={() => setTeamSheetOpen(true)}>
              <UserPlus size={15} />우리팀 간편 추가
            </button>
          </div>
          <div className="mobile-inline-add">
            <input value={participantText} onChange={(event) => setParticipantText(event.target.value)} placeholder="참석자 입력" />
            <button type="button" onClick={() => addValue(participantText, setParticipants, setParticipantText)}><Plus size={16} /></button>
          </div>
          <div className="mobile-chip-list">
            {participants.map((item, index) => <button type="button" key={`${item}-${index}`} onClick={() => setParticipants((prev) => prev.filter((_, i) => i !== index))}>{item}<X size={13} /></button>)}
          </div>
        </div>
      </section>
      <section className="mobile-form-card">
        {audioFile ? (
          <div className="mobile-record-linked-card">
            <div className="mobile-record-linked-main">
              <CheckCircle2 size={26} />
              <div>
                <b>회의 녹음 연동 완료</b>
                <span>{audioFile.name}</span>
              </div>
            </div>
            <button className="mobile-record-unlink-btn" type="button" onClick={onUnlinkAudio}>연동 해제</button>
          </div>
        ) : (
          <div className="mobile-record-link-grid">
            <button className="mobile-record-link-button" type="button" onClick={onOpenRecorder}>
              <Mic2 size={28} />
              <b>회의 녹음으로 이동</b>
              <span>녹음 종료 후 회의록 작성에 바로 연결됩니다.</span>
            </button>
            <button className="mobile-record-link-button secondary" type="button" onClick={onOpenDraftPicker}>
              <FileText size={28} />
              <b>보관 녹음 불러오기</b>
              <span>보관된 녹음을 재생해보고 연결합니다.</span>
            </button>
          </div>
        )}
        <label className="mobile-upload-tile secondary">
          <input type="file" accept=".ppt,.pptx,.pdf" multiple onChange={(event) => setReferenceFiles(Array.from(event.target.files || []))} />
          <FileText size={28} />
          <b>{referenceFiles.length ? `${referenceFiles.length}개 참고자료 선택됨` : '회의 참고자료 선택'}</b>
          <span>PPT, PPTX, PDF</span>
        </label>
      </section>
      {error && <div className="mobile-error-box">{error}</div>}
      {job && (
        <section className="mobile-panel">
          <div className="mobile-panel-head"><div><span>Processing</span><h2>{job.status === 'completed' ? '분석 완료' : '회의록 분석 중'}</h2></div><small>{job.progress}%</small></div>
          <div className="mobile-progress-track"><span style={{ width: `${job.progress || 0}%` }} /></div>
          <p className="mobile-job-message">{job.message}</p>
        </section>
      )}
      <button className="mobile-floating-action" type="button" disabled={!canStart} onClick={onUploadAndRun}>
        <Play size={18} />회의록 분석 시작
      </button>
      {teamSheetOpen && (
        <div className="mobile-sheet-backdrop" onClick={() => setTeamSheetOpen(false)}>
          <section className="mobile-team-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-detail-grip" />
            <div className="mobile-team-sheet-head">
              <div>
                <span>Team Members</span>
                <h2>우리팀 간편 추가</h2>
              </div>
              <div className="mobile-team-sheet-actions">
                <button className="mobile-secondary-action bordered" type="button" disabled={!availableTeamMembers.length} onClick={addAllTeamMembers}>
                  전체 추가
                </button>
                <button className="mobile-icon-btn" type="button" onClick={() => setTeamSheetOpen(false)}><X size={18} /></button>
              </div>
            </div>
            <div className="mobile-team-member-list">
              {teamMembers.map((memberName) => {
                const alreadyAdded = participants.includes(memberName);
                return (
                  <button
                    className={alreadyAdded ? 'mobile-team-member-card added' : 'mobile-team-member-card'}
                    type="button"
                    key={memberName}
                    disabled={alreadyAdded}
                    onClick={() => addTeamMember(memberName)}
                  >
                    <span>{memberName}</span>
                    <small>{alreadyAdded ? '추가됨' : '탭해서 추가'}</small>
                  </button>
                );
              })}
              {teamMembers.length === 0 && <div className="mobile-empty-card">등록된 팀원이 없습니다.</div>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function MobileWorkflowSheet({
  open,
  mode,
  onClose,
  speakerIds,
  speakerMatches,
  speakerMapping,
  onUpdateSpeakerName,
  selectedSpeakerFilter,
  setSelectedSpeakerFilter,
  filteredSentences,
  audioUrl,
  audioRef,
  onPlaySentence,
  onOpenSentenceEditor,
  onRemoveSentence,
  reportInstruction,
  setReportInstruction,
  isGeneratingReport,
  reportMarkdown,
  setReportMarkdown,
  reportCompleted,
  error,
  editingSentence,
  editingContent,
  setEditingContent,
  editingSpeaker,
  setEditingSpeaker,
  setEditingSentence,
  onSaveSentenceEdit,
  isSavingMap,
  onSaveSpeakerMapping,
  onGenerateReport,
  isFinalizingReport,
  onFinalizeReport,
  isCompletingReport,
  onCompleteReport,
}) {
  if (!open) return null;

  const title = mode === 'mapping' ? '화자 매핑 확인' : mode === 'report_instruction' ? '회의록 작성' : '회의록 확인';
  const kicker = mode === 'mapping' ? 'Speaker Mapping' : mode === 'report_instruction' ? 'Report Instruction' : 'Report Review';
  const stepIndex = mode === 'mapping' ? 1 : mode === 'report_instruction' ? 2 : 3;

  return (
    <div className="mobile-workflow-backdrop">
      <section className="mobile-workflow-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mobile-detail-grip" />
        <div className="mobile-workflow-head">
          <div>
            <span>{kicker}</span>
            <h2>{title}</h2>
          </div>
          <button className="mobile-icon-btn" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="mobile-workflow-steps" aria-label="회의록 작성 단계">
          {['화자 매핑', '작성 지시', '회의록 확인'].map((step, index) => (
            <div className={index + 1 <= stepIndex ? 'active' : ''} key={step}>
              <span>{index + 1}</span>
              <b>{step}</b>
            </div>
          ))}
        </div>

        {mode === 'mapping' && (
          <div className="mobile-workflow-body">
            <section className="mobile-workflow-card">
              <div className="mobile-workflow-card-head">
                <div><span>Speakers</span><h3>화자 이름 확인</h3></div>
                <small>{speakerIds.length}명</small>
              </div>
              <div className="mobile-speaker-map-list">
                {speakerIds.map((speakerId) => {
                  const match = matchBySpeaker(speakerMatches, speakerId);
                  return (
                    <label className="mobile-speaker-map-card" key={speakerId}>
                      <div className="mobile-speaker-map-title">
                        <span>Speaker {speakerId}</span>
                        <small>신뢰도 {match?.confidence ?? '-'}</small>
                      </div>
                      <input
                        type="text"
                        value={speakerMapping[String(speakerId)] || ''}
                        onChange={(event) => onUpdateSpeakerName(speakerId, event.target.value)}
                        placeholder={`Speaker ${speakerId}`}
                      />
                      <p>{match?.evidence || '자동 매칭 근거가 없습니다.'}</p>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="mobile-workflow-card">
              <div className="mobile-workflow-card-head">
                <div><span>Audio</span><h3>발화 확인</h3></div>
              </div>
              {audioUrl ? <audio className="mobile-audio-player" ref={audioRef} src={audioUrl} controls preload="metadata" /> : <div className="mobile-empty-card">첨부된 오디오가 없습니다.</div>}
              <label className="mobile-field mobile-speaker-filter">
                <span>Speaker 필터</span>
                <select value={selectedSpeakerFilter} onChange={(event) => setSelectedSpeakerFilter(event.target.value)}>
                  <option value="all">모두</option>
                  {speakerIds.map((speakerId) => <option value={String(speakerId)} key={`mobile-speaker-filter-${speakerId}`}>Speaker {speakerId}</option>)}
                </select>
              </label>
              <div className="mobile-sentence-list">
                {filteredSentences.map((sentence) => (
                  <article className="mobile-sentence-card" key={sentence.index}>
                    <div className="mobile-sentence-meta">
                      <span>Speaker {normalizeSpeakerId(sentence.speaker_id ?? sentence.speaker)}</span>
                      <small>{sentence.time}</small>
                    </div>
                    <p>{sentence.content}</p>
                    <div className="mobile-sentence-actions">
                      <button type="button" onClick={() => onPlaySentence(sentence)}><Play size={12} />재생</button>
                      <button type="button" onClick={() => onOpenSentenceEditor(sentence)}><Pencil size={12} />편집</button>
                      <button className="danger" type="button" onClick={() => onRemoveSentence(sentence.index)}><Trash2 size={12} />제거</button>
                    </div>
                  </article>
                ))}
                {filteredSentences.length === 0 && <div className="mobile-empty-card">선택한 Speaker의 발화가 없습니다.</div>}
              </div>
            </section>
          </div>
        )}

        {mode === 'report_instruction' && (
          <div className="mobile-workflow-body">
            <section className="mobile-workflow-card">
              <div className="mobile-workflow-card-head">
                <div><span>Instruction</span><h3>회의록 작성 관점</h3></div>
              </div>
              <p className="mobile-workflow-help">선택 입력입니다. 특정 인물, 의사결정, 질의응답 등 회의록에서 강조할 기준을 적을 수 있습니다.</p>
              <textarea
                className="mobile-report-textarea"
                value={reportInstruction}
                onChange={(event) => setReportInstruction(event.target.value)}
                placeholder="예) 주요 의사결정과 후속 액션을 중심으로 정리하고, 기술 용어는 원문 표현을 유지한다."
                rows={10}
                disabled={isGeneratingReport}
              />
              {isGeneratingReport && (
                <div className="mobile-generating-card">
                  <span className="loading-spinner" aria-hidden="true"></span>
                  <div><b>회의록 생성 중입니다.</b><p>화자 매핑 결과를 바탕으로 회의록을 작성하고 있습니다.</p></div>
                </div>
              )}
            </section>
          </div>
        )}

        {mode === 'report_review' && (
          <div className="mobile-workflow-body">
            <section className="mobile-workflow-card">
              <div className="mobile-workflow-card-head">
                <div><span>Markdown</span><h3>{reportCompleted ? '확정된 회의록' : '회의록 확인 및 수정'}</h3></div>
              </div>
              {reportCompleted ? (
                <div className="mobile-final-report-view">
                  <MarkdownReport markdown={reportMarkdown} />
                </div>
              ) : (
                <textarea
                  className="mobile-report-textarea review"
                  value={reportMarkdown}
                  onChange={(event) => setReportMarkdown(event.target.value)}
                  rows={18}
                />
              )}
              {reportCompleted && <div className="mobile-info-box">회의록이 확정되었습니다. 완료를 누르면 라운지에 저장됩니다.</div>}
            </section>
          </div>
        )}

        {error && <div className="mobile-error-box">{error}</div>}

        {editingSentence && (
          <div className="mobile-edit-backdrop">
            <section className="mobile-edit-dialog">
              <div className="mobile-workflow-card-head">
                <div><span>Sentence Edit</span><h3>발화 내용 편집</h3></div>
                <button className="mobile-icon-btn" type="button" onClick={() => setEditingSentence(null)}><X size={18} /></button>
              </div>
              <div className="mobile-edit-time">{editingSentence.time}</div>
              <label className="mobile-field">
                <span>Speaker Index</span>
                <input type="text" value={editingSpeaker} onChange={(event) => setEditingSpeaker(event.target.value)} placeholder="예) 0" />
              </label>
              <label className="mobile-field">
                <span>발화 내용</span>
                <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} rows={6} />
              </label>
              <div className="mobile-edit-actions">
                <button className="mobile-secondary-action bordered" type="button" onClick={() => setEditingSentence(null)}>취소</button>
                <button className="mobile-primary-action dark" type="button" onClick={onSaveSentenceEdit}>저장</button>
              </div>
            </section>
          </div>
        )}

        <div className="mobile-workflow-actions">
          {mode === 'mapping' && (
            <button className="mobile-primary-action dark" type="button" onClick={onSaveSpeakerMapping} disabled={isSavingMap}>
              {isSavingMap ? <span className="btn-spinner" aria-hidden="true"></span> : <CheckCircle2 size={18} />}
              {isSavingMap ? '저장 중' : '매핑 저장'}
            </button>
          )}
          {mode === 'report_instruction' && (
            <button className="mobile-primary-action dark" type="button" onClick={onGenerateReport} disabled={isGeneratingReport}>
              {isGeneratingReport ? <span className="btn-spinner" aria-hidden="true"></span> : <FileText size={18} />}
              {isGeneratingReport ? '생성 중' : '회의록 생성'}
            </button>
          )}
          {mode === 'report_review' && !reportCompleted && (
            <button className="mobile-primary-action dark" type="button" onClick={onFinalizeReport} disabled={isFinalizingReport || !reportMarkdown.trim()}>
              {isFinalizingReport ? <span className="btn-spinner" aria-hidden="true"></span> : <CheckCircle2 size={18} />}
              {isFinalizingReport ? '확정 중' : '회의록 확정'}
            </button>
          )}
          {mode === 'report_review' && reportCompleted && (
            <button className="mobile-primary-action dark" type="button" onClick={onCompleteReport} disabled={isCompletingReport}>
              {isCompletingReport ? <span className="btn-spinner" aria-hidden="true"></span> : <CheckCircle2 size={18} />}
              {isCompletingReport ? '저장 중' : '완료'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function MobileLoungePage({
  isLoadingLounge,
  loungeError,
  filteredLoungeReports,
  loungeCategoryOptions,
  loungeCategoryFilter,
  setLoungeCategoryFilter,
  loungeMonthFilter,
  setLoungeMonthFilter,
  selectedLoungeReport,
  loungeDetail,
  loungeAudioUrl,
  isLoadingLoungeDetail,
  isLoadingLoungeAudio,
  loungeAudioRef,
  onOpenReport,
  onCloseReport,
  onPlayRecap,
}) {
  const [detailTab, setDetailTab] = useState('report');

  useEffect(() => {
    setDetailTab('report');
  }, [selectedLoungeReport?.report_uuid]);

  return (
    <>
      <MobilePageHeader
        kicker="Report Lounge"
        title="회의록 라운지"
        description="저장된 회의록을 모바일에서 빠르게 확인합니다."
      />
      <section className="mobile-filter-card">
        <select value={loungeCategoryFilter} onChange={(event) => setLoungeCategoryFilter(event.target.value)}>
          <option value="all">전체 카테고리</option>
          {loungeCategoryOptions.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}
        </select>
        <input type="month" value={loungeMonthFilter} onChange={(event) => setLoungeMonthFilter(event.target.value)} />
      </section>
      {loungeError && <div className="mobile-error-box">{loungeError}</div>}
      {isLoadingLounge && <div className="mobile-empty-card">회의록을 불러오는 중입니다.</div>}
      <section className="mobile-report-list">
        {filteredLoungeReports.map((report) => (
          <button className="mobile-report-card" type="button" key={report.report_uuid} onClick={() => onOpenReport(report)}>
            <b>{report.title}</b>
            <span>{report.category_name || '카테고리 미지정'} · 참가 {(report.participants || []).length}명</span>
            <small>{report.meeting_date || '-'} · {report.start_time || '--:--'} - {report.end_time || '--:--'}</small>
          </button>
        ))}
        {!isLoadingLounge && filteredLoungeReports.length === 0 && <div className="mobile-empty-card">표시할 회의록이 없습니다.</div>}
      </section>
      {selectedLoungeReport && (
        <div className="mobile-detail-sheet">
          <div className="mobile-detail-grip" />
          <div className="mobile-detail-head">
            <div>
              <span>Report</span>
              <h2>{selectedLoungeReport.title}</h2>
            </div>
            <button className="mobile-icon-btn" type="button" onClick={onCloseReport}><X size={18} /></button>
          </div>
          <div className="mobile-detail-tabs" role="tablist" aria-label="회의록 상세 보기">
            <button className={detailTab === 'report' ? 'active' : ''} type="button" role="tab" aria-selected={detailTab === 'report'} onClick={() => setDetailTab('report')}>회의록</button>
            <button className={detailTab === 'recap' ? 'active' : ''} type="button" role="tab" aria-selected={detailTab === 'recap'} onClick={() => setDetailTab('recap')}>녹음 복기</button>
          </div>
          {detailTab === 'report' && (
            isLoadingLoungeDetail ? <div className="mobile-empty-card">회의록을 불러오는 중입니다.</div> : <MarkdownReport markdown={loungeDetail?.report_markdown || ''} />
          )}
          {detailTab === 'recap' && (
            <div className="mobile-recap-tab-panel">
              <section className="mobile-panel compact">
                <div className="mobile-panel-head"><div><span>Audio</span><h2>회의 오디오</h2></div></div>
                {loungeAudioUrl ? <audio className="mobile-audio-player" ref={loungeAudioRef} src={loungeAudioUrl} controls preload="metadata" /> : <div className="mobile-empty-card">{isLoadingLoungeAudio ? '오디오를 불러오는 중입니다.' : '저장된 오디오가 없습니다.'}</div>}
              </section>
              <section className="mobile-panel compact">
                <div className="mobile-panel-head"><div><span>Recap</span><h2>회의록 복기</h2></div></div>
                <div className="mobile-recap-list">
                  {(loungeDetail?.recap || []).slice(0, 20).map((item, index) => (
                    <button className="mobile-recap-card" type="button" key={`${item.index ?? index}-${item.time || ''}`} onClick={() => onPlayRecap(item)}>
                      <span>{item.speaker || item.speaker_id || 'Speaker'} · {item.time || '--:--'}</span>
                      <b>{item.content || item.sentence || ''}</b>
                    </button>
                  ))}
                  {!isLoadingLoungeDetail && (!loungeDetail?.recap || loungeDetail.recap.length === 0) && <div className="mobile-empty-card">복기할 녹음 구간이 없습니다.</div>}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MobileMeetApp({ current, children, onNavigate }) {
  return (
    <main className="mobile-meet-shell has-bottom-nav">
      {children}
      <MobileBottomNav current={current} onNavigate={onNavigate} />
    </main>
  );
}

function getKstToday() {
  const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate());
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatRecordingDuration(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return { minutes, seconds: rest };
}

function App() {
  const [authUser, setAuthUser] = useState(() => {
    const saved = window.localStorage.getItem('wiameet_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem('wiameet_token') || '');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [accountUsers, setAccountUsers] = useState([]);
  const [accountError, setAccountError] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ username: '', display_name: '', role: 'user' });
  const [resettingPasswordId, setResettingPasswordId] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberName, setMemberName] = useState('');
  const [memberError, setMemberError] = useState('');
  const [memberMessage, setMemberMessage] = useState('');
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isCreatingMember, setIsCreatingMember] = useState(false);
  const [draggingMemberUuid, setDraggingMemberUuid] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoryName, setCategoryName] = useState('');
  const [selectedCategoryUuid, setSelectedCategoryUuid] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [categoryMessage, setCategoryMessage] = useState('');
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [draggingCategoryUuid, setDraggingCategoryUuid] = useState('');
  const [settingsTab, setSettingsTab] = useState('members');
  const [requiredPassword, setRequiredPassword] = useState('');
  const [requiredPasswordConfirm, setRequiredPasswordConfirm] = useState('');
  const [requiredPasswordError, setRequiredPasswordError] = useState('');
  const [isUpdatingRequiredPassword, setIsUpdatingRequiredPassword] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [pcCreateAudioFile, setPcCreateAudioFile] = useState(null);
  const [mobileCreateAudioFile, setMobileCreateAudioFile] = useState(null);
  const [mobileCreateAudioLinked, setMobileCreateAudioLinked] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const [recordingBars, setRecordingBars] = useState(() => Array(RECORD_BAR_COUNT).fill(6));
  const [confirmClearRecording, setConfirmClearRecording] = useState(false);
  const [draftSaveOpen, setDraftSaveOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [recordingDrafts, setRecordingDrafts] = useState([]);
  const [draftPickerOpen, setDraftPickerOpen] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [recordingDraftMessage, setRecordingDraftMessage] = useState('');
  const [recordingDraftError, setRecordingDraftError] = useState('');
  const [savedDraftAudioKey, setSavedDraftAudioKey] = useState('');
  const [referenceFiles, setReferenceFiles] = useState([]);
  const emptyTimeParts = { period: 'AM', hour: '', minute: '00' };
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingStartTime, setMeetingStartTime] = useState('');
  const [meetingEndTime, setMeetingEndTime] = useState('');
  const [meetingStartTimeParts, setMeetingStartTimeParts] = useState(emptyTimeParts);
  const [meetingEndTimeParts, setMeetingEndTimeParts] = useState(emptyTimeParts);
  const [meetingOrganizations, setMeetingOrganizations] = useState(() => defaultMeetingOrganizations());
  const [organizationInput, setOrganizationInput] = useState('');
  const [participants, setParticipants] = useState([]);
  const [participantInput, setParticipantInput] = useState('');
  const [meetingPurpose, setMeetingPurpose] = useState('');
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [speakerMapping, setSpeakerMapping] = useState({});
  const [speakerMatches, setSpeakerMatches] = useState({ matches: [] });
  const [mappedSentences, setMappedSentences] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('mapping');
  const [currentView, setCurrentView] = useState('home');
  const [mobilePath, setMobilePath] = useState(() => window.location.pathname);
  const [error, setError] = useState('');
  const [isSavingMap, setIsSavingMap] = useState(false);
  const [reportInstruction, setReportInstruction] = useState('');
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isFinalizingReport, setIsFinalizingReport] = useState(false);
  const [isCompletingReport, setIsCompletingReport] = useState(false);
  const [loungeReports, setLoungeReports] = useState([]);
  const [isLoadingLounge, setIsLoadingLounge] = useState(false);
  const [loungeCategoryFilter, setLoungeCategoryFilter] = useState('all');
  const [loungeMonthFilter, setLoungeMonthFilter] = useState('');
  const [homeCategoryMonth, setHomeCategoryMonth] = useState(() => formatMonthKey(getKstToday()));
  const [loungeError, setLoungeError] = useState('');
  const [selectedLoungeReport, setSelectedLoungeReport] = useState(null);
  const [loungeDetail, setLoungeDetail] = useState(null);
  const [isLoadingLoungeDetail, setIsLoadingLoungeDetail] = useState(false);
  const [isLoadingLoungeAudio, setIsLoadingLoungeAudio] = useState(false);
  const [loungeAudioUrl, setLoungeAudioUrl] = useState('');
  const [meetingInfoOpen, setMeetingInfoOpen] = useState(false);
  const [processGuideOpen, setProcessGuideOpen] = useState(false);
  const [userGuideOpen, setUserGuideOpen] = useState(false);
  const [mobileAppModalOpen, setMobileAppModalOpen] = useState(false);
  const [mobileAppQrUrl, setMobileAppQrUrl] = useState('');
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [isStandaloneApp, setIsStandaloneApp] = useState(() => isPwaStandalone());
  const [isDownloadingReferences, setIsDownloadingReferences] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState('');
  const [reportCompleted, setReportCompleted] = useState(false);
  const [editingSentence, setEditingSentence] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingSpeaker, setEditingSpeaker] = useState('');
  const [selectedSpeakerFilter, setSelectedSpeakerFilter] = useState('all');
  const [confluenceForm, setConfluenceForm] = useState({
    page_url: '',
    token: '',
    enabled: false,
  });
  const [confluenceSettings, setConfluenceSettings] = useState(null);
  const [isLoadingConfluenceSettings, setIsLoadingConfluenceSettings] = useState(false);
  const [confluenceError, setConfluenceError] = useState('');
  const [confluenceUiMessage, setConfluenceUiMessage] = useState('');
  const [isTestingConfluence, setIsTestingConfluence] = useState(false);
  const [isDisconnectingConfluence, setIsDisconnectingConfluence] = useState(false);
  const [confluenceTestSuccess, setConfluenceTestSuccess] = useState(null);
  const [showConfluenceToken, setShowConfluenceToken] = useState(false);
  const pollRef = useRef(null);
  const processRef = useRef(null);
  const logBodyRef = useRef(null);
  const audioRef = useRef(null);
  const loungeAudioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const isMobileRoute = mobilePath === '/mobile' || mobilePath.startsWith('/mobile/');
  const mobileView = getMobileViewFromPath(mobilePath);
  const mobilePlatform = useMemo(() => detectMobilePlatform(), []);
  const settingsTitle = {
    members: '멤버 관리',
    categories: '카테고리 관리',
    confluence: 'Confluence 관리',
  }[settingsTab] || '설정';
  const settingsDescription = {
    members: '회의 참석자 빠른 추가에 사용할 우리 팀 인원을 관리합니다.',
    categories: '회의록을 분류할 카테고리를 관리합니다.',
    confluence: '회의록을 Confluence에 연동하기 위한 설정을 관리합니다.',
  }[settingsTab] || '';

  const speakerIds = useMemo(() => speakerIdsFromResult(result), [result]);
  const filteredSentences = useMemo(() => {
    const sentences = result?.sentences || [];
    if (selectedSpeakerFilter === 'all') return sentences;
    return sentences.filter((sentence) => normalizeSpeakerId(sentence.speaker_id ?? sentence.speaker) === selectedSpeakerFilter);
  }, [result, selectedSpeakerFilter]);
  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : ''), [audioFile]);
  const activeMeetingAudioFile = isMobileRoute && mobileView === 'create' ? (mobileCreateAudioLinked ? mobileCreateAudioFile : null) : pcCreateAudioFile;
  const analysisAudioUrl = useMemo(() => (activeMeetingAudioFile ? URL.createObjectURL(activeMeetingAudioFile) : audioUrl), [activeMeetingAudioFile, audioUrl]);
  const recorderSupported = typeof window !== 'undefined' && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
  const recordingStatus = isRecording ? (isRecordingPaused ? 'paused' : 'recording') : audioFile ? 'stopped' : 'idle';
  const recordingStatusLabel = {
    idle: '녹음 대기',
    recording: '녹음 중',
    paused: '일시정지',
    stopped: '녹음 완료',
  }[recordingStatus];
  const mobileAppUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/mobile';
    return `${window.location.origin}/mobile`;
  }, []);

  useEffect(() => {
    if (!mobileAppModalOpen) return;
    QRCode.toDataURL(mobileAppUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then(setMobileAppQrUrl)
      .catch(() => setMobileAppQrUrl(''));
  }, [mobileAppModalOpen, mobileAppUrl]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    };
    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsStandaloneApp(true);
      setInstallHelpOpen(false);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function installMobileApp() {
    if (isStandaloneApp) return;
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      setDeferredInstallPrompt(null);
      promptEvent.prompt();
      await promptEvent.userChoice.catch(() => undefined);
      setIsStandaloneApp(isPwaStandalone());
      return;
    }
    setInstallHelpOpen(true);
  }

  const recordingHasContent = recordingStatus !== 'idle';
  const selectedCategory = useMemo(() => (
    categories.find((category) => category.category_uuid === selectedCategoryUuid) || null
  ), [categories, selectedCategoryUuid]);
  const loungeCategoryOptions = useMemo(() => {
    const options = new Map();
    for (const report of loungeReports) {
      const key = report.category_uuid || `name:${report.category_name || '카테고리 미지정'}`;
      if (!options.has(key)) {
        options.set(key, { value: key, label: report.category_name || '카테고리 미지정' });
      }
    }
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [loungeReports]);
  const filteredLoungeReports = useMemo(() => {
    return loungeReports.filter((report) => {
      const key = report.category_uuid || `name:${report.category_name || '카테고리 미지정'}`;
      const categoryMatched = loungeCategoryFilter === 'all' || key === loungeCategoryFilter;
      const monthMatched = !loungeMonthFilter || (report.meeting_date || '').startsWith(`${loungeMonthFilter}-`);
      return categoryMatched && monthMatched;
    });
  }, [loungeReports, loungeCategoryFilter, loungeMonthFilter]);
  const groupedLoungeReports = useMemo(() => {
    const groups = new Map();
    for (const report of filteredLoungeReports) {
      const dateKey = report.meeting_date || '날짜 없음';
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey).push(report);
    }
    return Array.from(groups.entries()).map(([date, reports]) => ({ date, reports }));
  }, [filteredLoungeReports]);
  const homeStats = useMemo(() => {
    const kstToday = getKstToday();
    const day = kstToday.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    const thisWeekMonday = new Date(kstToday);
    thisWeekMonday.setDate(kstToday.getDate() - daysSinceMonday);
    const lastWeekMonday = new Date(thisWeekMonday);
    lastWeekMonday.setDate(thisWeekMonday.getDate() - 7);
    const lastWeekFriday = new Date(lastWeekMonday);
    lastWeekFriday.setDate(lastWeekMonday.getDate() + 4);
    const monthStart = new Date(kstToday.getFullYear(), kstToday.getMonth(), 1);
    const monthEnd = new Date(kstToday.getFullYear(), kstToday.getMonth() + 1, 0);
    const lastWeekStartKey = formatDateKey(lastWeekMonday);
    const lastWeekEndKey = formatDateKey(lastWeekFriday);
    const monthStartKey = formatDateKey(monthStart);
    const monthEndKey = formatDateKey(monthEnd);
    const inDateRange = (report, startKey, endKey) => {
      const dateKey = report.meeting_date || '';
      return dateKey >= startKey && dateKey <= endKey;
    };
    const countItems = (items) => {
      const counts = new Map();
      for (const item of items) {
        if (!item) continue;
        counts.set(item, (counts.get(item) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
    };

    const lastWeekReports = loungeReports.filter((report) => inDateRange(report, lastWeekStartKey, lastWeekEndKey));
    const thisMonthReports = loungeReports.filter((report) => inDateRange(report, monthStartKey, monthEndKey));
    const teamMemberNames = new Set(members.map((member) => member.member_name));
    const participantRank = countItems(
      lastWeekReports.flatMap((report) => (report.participants || []).filter((participant) => teamMemberNames.has(participant))),
    );
    const selectedCategoryMonthReports = loungeReports.filter((report) => (report.meeting_date || '').startsWith(`${homeCategoryMonth}-`));
    const organizationRank = countItems(thisMonthReports.flatMap((report) => report.organizations || []));
    const categoryRank = countItems(selectedCategoryMonthReports.map((report) => report.category_name || '카테고리 미지정'));
    const recentReports = [...loungeReports]
      .sort((a, b) => `${b.meeting_date || ''} ${b.start_time || ''}`.localeCompare(`${a.meeting_date || ''} ${a.start_time || ''}`))
      .slice(0, 5);
    return {
      totalReports: loungeReports.length,
      lastWeekCount: lastWeekReports.length,
      thisMonthCount: thisMonthReports.length,
      lastWeekRange: `${lastWeekStartKey} ~ ${lastWeekEndKey}`,
      thisMonthRange: `${monthStartKey} ~ ${monthEndKey}`,
      categoryMonth: homeCategoryMonth,
      categoryMonthTotal: selectedCategoryMonthReports.length,
      topParticipant: participantRank[0] || null,
      topOrganization: organizationRank[0] || null,
      categoryRank,
      recentReports,
    };
  }, [loungeReports, members, homeCategoryMonth]);
  const canStart = activeMeetingAudioFile && meetingTitle.trim() && selectedCategoryUuid && meetingPurpose.trim() && meetingDate && meetingStartTime && meetingEndTime && meetingOrganizations.length > 0 && participants.length > 0 && (!job || job.status === 'failed' || job.status === 'completed');

  const currentKstMonth = useMemo(() => formatMonthKey(getKstToday()), []);
  const canMoveHomeCategoryMonthNext = homeCategoryMonth < currentKstMonth;
  const creationProcessSteps = [
    '오디오 분석',
    '화자 분리',
    '화자 구간 전처리',
    'STT 전환',
    '문맥 기반 교정',
    '화자 자동 매칭',
  ];

  function moveHomeCategoryMonth(offset) {
    const [year, month] = homeCategoryMonth.split('-').map(Number);
    const nextDate = new Date(year, month - 1 + offset, 1);
    const nextMonth = formatMonthKey(nextDate);
    if (nextMonth > currentKstMonth) return;
    setHomeCategoryMonth(nextMonth);
  }


  function preferredAudioMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) || '';
  }

  function recordingFileExtension(mimeType) {
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    return 'webm';
  }

  function downloadRecordedAudio() {
    if (!audioFile || !audioUrl) return;

    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = audioFile.name || 'meeting-recording.webm';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function audioDraftKey(file = audioFile) {
    return file ? `${file.name}:${file.size}:${file.lastModified}` : '';
  }

  function defaultDraftTitle() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `보관 녹음 ${year}-${month}-${day} ${hour}:${minute}`;
  }

  function formatDurationLabel(seconds) {
    const duration = formatRecordingDuration(Number(seconds || 0));
    return `${duration.minutes}:${duration.seconds}`;
  }

  function openDraftSaveDialog() {
    if (savedDraftAudioKey && savedDraftAudioKey === audioDraftKey()) return;
    setDraftTitle(defaultDraftTitle());
    setRecordingDraftError('');
    setRecordingDraftMessage('');
    setDraftSaveOpen(true);
  }

  async function persistRecordingDraft(titleValue) {
    if (!audioFile) return false;
    setIsSavingDraft(true);
    setRecordingDraftError('');
    setRecordingDraftMessage('');
    try {
      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('title', titleValue || defaultDraftTitle());
      formData.append('duration_seconds', String(recordingSeconds || 0));
      const response = await fetch(`${API_BASE}/api/recording-drafts`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (response.status === 401) {
        handleExpiredSession();
        return false;
      }
      if (!response.ok) throw await apiError(response, '녹음 보관에 실패했습니다.');
      setSavedDraftAudioKey(audioDraftKey());
      setRecordingDraftMessage('녹음을 보관했습니다. 보관된 녹음은 7일 간 유지됩니다.');
      await loadRecordingDrafts();
      return true;
    } catch (err) {
      setRecordingDraftError(err.message);
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function saveRecordingDraft(event) {
    event.preventDefault();
    const saved = await persistRecordingDraft(draftTitle);
    if (saved) setDraftSaveOpen(false);
  }

  async function loadRecordingDrafts() {
    setIsLoadingDrafts(true);
    setRecordingDraftError('');
    try {
      const response = await fetch(`${API_BASE}/api/recording-drafts`, { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, '보관 녹음 목록을 불러오지 못했습니다.');
      const data = await response.json();
      setRecordingDrafts(data.drafts || []);
    } catch (err) {
      setRecordingDraftError(err.message);
    } finally {
      setIsLoadingDrafts(false);
    }
  }

  async function openDraftPicker() {
    setDraftPickerOpen(true);
    await loadRecordingDrafts();
  }

  async function useRecordingDraft(draft) {
    setRecordingDraftError('');
    try {
      const response = await fetch(`${API_BASE}/api/recording-drafts/${draft.draft_uuid}/audio`, { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, '보관 녹음을 불러오지 못했습니다.');
      const blob = await response.blob();
      const file = new File([blob], `${draft.title || '보관 녹음'}.webm`, { type: blob.type || 'audio/webm' });
      if (isMobileRoute && mobileView === 'create') {
        setMobileCreateAudioFile(file);
        setMobileCreateAudioLinked(true);
      } else {
        setPcCreateAudioFile(file);
        setMobileCreateAudioFile(null);
        setMobileCreateAudioLinked(false);
      }
      setSavedDraftAudioKey('');
      setDraftPickerOpen(false);
      setRecordingDraftMessage(`보관 녹음 "${draft.title}"을 불러왔습니다.`);
    } catch (err) {
      setRecordingDraftError(err.message);
    }
  }

  async function startBrowserRecording() {
    if (!recorderSupported) {
      setRecordingError('이 브라우저에서는 녹음을 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 사용하세요.');
      return;
    }

    setRecordingError('');
    setRecordingDraftError('');
    setRecordingDraftMessage('');
    setSavedDraftAudioKey('');
    setMobileCreateAudioFile(null);
    setMobileCreateAudioLinked(false);
    setConfirmClearRecording(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      setAudioFile(null);
      setPcCreateAudioFile(null);
      setMobileCreateAudioFile(null);
      setMobileCreateAudioLinked(false);
      recordingChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: finalMimeType });
        const extension = recordingFileExtension(finalMimeType);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = new File([blob], `meeting-recording-${timestamp}.${extension}`, { type: finalMimeType });
        setAudioFile(file);
        setMobileCreateAudioLinked(false);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
      };

      setRecordingSeconds(0);
      setIsRecording(true);
      setIsRecordingPaused(false);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
      recorder.start(1000);
    } catch (err) {
      setRecordingError(err?.message || '마이크 권한을 얻지 못했습니다. 브라우저 권한 설정을 확인하세요.');
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    }
  }

  function pauseOrResumeBrowserRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === 'recording') {
      recorder.pause();
      setIsRecordingPaused(true);
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }

    if (recorder.state === 'paused') {
      recorder.resume();
      setIsRecordingPaused(false);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
    }
  }

  function stopBrowserRecording() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.stop();
      return;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function clearRecordedAudio() {
    if (isRecording) stopBrowserRecording();
    setAudioFile(null);
    setPcCreateAudioFile(null);
    setMobileCreateAudioFile(null);
    setMobileCreateAudioLinked(false);
    setRecordingSeconds(0);
    setRecordingError('');
    setRecordingDraftError('');
    setRecordingDraftMessage('');
    setSavedDraftAudioKey('');
    setIsRecordingPaused(false);
    setConfirmClearRecording(false);
  }

  function openRecorderFromMeetingForm() {
    setConfirmClearRecording(false);
    setRecordingError('');
    setCurrentView('record');
  }

  async function useRecordedAudioForMeetingForm() {
    setConfirmClearRecording(false);
    if (audioFile && savedDraftAudioKey !== audioDraftKey()) {
      const saved = await persistRecordingDraft(defaultDraftTitle());
      if (!saved) return;
    }
    if (isMobileRoute) {
      setMobileCreateAudioFile(audioFile);
      setMobileCreateAudioLinked(true);
      navigateMobile('create');
    } else {
      setPcCreateAudioFile(audioFile);
      setCurrentView('create');
    }
  }

  function defaultMeetingOrganizations(user = authUser) {
    return user?.display_name ? [user.display_name] : [];
  }

  function resetMeetingForm(user = authUser) {
    setAudioFile(null);
    setPcCreateAudioFile(null);
    setMobileCreateAudioFile(null);
    setMobileCreateAudioLinked(false);
    setReferenceFiles([]);
    setMeetingTitle('');
    setSelectedCategoryUuid('');
    setMeetingPurpose('');
    setMeetingDate('');
    setMeetingStartTime('');
    setMeetingEndTime('');
    setMeetingStartTimeParts(emptyTimeParts);
    setMeetingEndTimeParts(emptyTimeParts);
    setMeetingOrganizations(defaultMeetingOrganizations(user));
    setOrganizationInput('');
    setParticipants([]);
    setParticipantInput('');
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => setMobilePath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigateMobile(view) {
    const path = view === 'home' ? '/mobile/home' : `/mobile/${view}`;
    window.history.pushState({}, '', path);
    setMobilePath(path);
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);


  useEffect(() => {
    if (!isRecording || isRecordingPaused) {
      setRecordingBars(Array(RECORD_BAR_COUNT).fill(6));
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setRecordingBars(Array.from({ length: RECORD_BAR_COUNT }, () => 6 + Math.round(Math.random() * Math.random() * 34)));
    }, 110);
    return () => window.clearInterval(intervalId);
  }, [isRecording, isRecordingPaused]);

  useEffect(() => {
    if (!logBodyRef.current) return;
    logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
  }, [job?.logs?.length]);

  useEffect(() => {
    if (!authToken) return;
    if (currentView === 'accounts' && authUser?.role === 'admin') {
      loadAccounts();
    }
  }, [currentView, authUser?.role, authToken]);

  useEffect(() => {
    if (!authToken) return;
    if (currentView === 'home' || currentView === 'lounge' || (isMobileRoute && (mobileView === 'home' || mobileView === 'lounge'))) {
      loadLoungeReports();
    }
  }, [currentView, authToken, isMobileRoute, mobileView]);

  useEffect(() => {
    if (!authToken) return;
    if (currentView === 'home' || currentView === 'record' || currentView === 'create' || currentView === 'settings' || isMobileRoute) {
      loadMembers();
    }
    if (currentView === 'create' || currentView === 'settings' || (isMobileRoute && mobileView === 'create')) {
      loadCategories();
    }
  }, [currentView, authToken, isMobileRoute, mobileView]);

  useEffect(() => {
    if (!authToken || currentView !== 'settings' || settingsTab !== 'confluence') return;
    loadConfluenceSettings();
  }, [currentView, settingsTab, authToken]);

  async function loadConfluenceSettings() {
    setIsLoadingConfluenceSettings(true);
    setConfluenceError('');
    setConfluenceUiMessage('');
    try {
      const response = await fetch(API_BASE + '/api/confluence-settings', { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, 'Confluence 설정을 불러오지 못했습니다.');
      const data = await response.json();
      setConfluenceSettings(data);
      if (data.setting) {
        setConfluenceForm((prev) => ({
          ...prev,
          page_url: displayConfluenceUrl(data.setting.page_url),
          enabled: Boolean(data.setting.enabled),
          token: '',
        }));
      }
    } catch (err) {
      setConfluenceError(err.message);
    } finally {
      setIsLoadingConfluenceSettings(false);
    }
  }

  async function loadLoungeReports() {
    setIsLoadingLounge(true);
    setLoungeError('');
    try {
      const response = await fetch(API_BASE + '/api/reports', { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('회의록 라운지를 불러오지 못했습니다.');
      const data = await response.json();
      setLoungeReports(data.reports || []);
    } catch (err) {
      setLoungeError(err.message);
    } finally {
      setIsLoadingLounge(false);
    }
  }

  async function openLoungeReport(report) {
    setSelectedLoungeReport(report);
    setLoungeDetail(null);
    setIsLoadingLoungeDetail(true);
    setIsLoadingLoungeAudio(false);
    setLoungeError('');
    setLoungeAudioUrl('');

    try {
      const response = await fetch(API_BASE + '/api/reports/' + report.job_id, { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('회의록 상세를 불러오지 못했습니다.');
      const detail = await response.json();
      setLoungeDetail(detail);
      setIsLoadingLoungeDetail(false);

      if (detail.has_audio) {
        setLoungeAudioUrl(authenticatedUrl('/api/reports/' + report.job_id + '/audio'));
      }
    } catch (err) {
      setLoungeError(err.message);
      setIsLoadingLoungeDetail(false);
    } finally {
      setIsLoadingLoungeAudio(false);
    }
  }

  function closeLoungeReport() {
    setSelectedLoungeReport(null);
    setLoungeDetail(null);
    setIsLoadingLoungeAudio(false);
    setMeetingInfoOpen(false);
    setLoungeAudioUrl('');
  }

  async function deleteLoungeReport(report) {
    if (!report?.job_id || deletingReportId) return;
    const confirmed = window.confirm(`"${report.title || '회의록'}" 회의록을 삭제할까요? 삭제하면 회의록, 녹음, 참고자료가 함께 삭제됩니다.`);
    if (!confirmed) return;

    setDeletingReportId(report.job_id);
    setLoungeError('');
    try {
      const response = await fetch(API_BASE + '/api/reports/' + report.job_id, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, '회의록을 삭제하지 못했습니다.');
      setLoungeReports((prev) => prev.filter((item) => item.job_id !== report.job_id));
      if (selectedLoungeReport?.job_id === report.job_id) closeLoungeReport();
    } catch (err) {
      setLoungeError(err.message);
    } finally {
      setDeletingReportId('');
    }
  }

  async function downloadReferenceZip() {
    const jobId = selectedLoungeReport?.job_id || loungeDetail?.job_id;
    if (!jobId || !loungeDetail?.has_references) return;
    setIsDownloadingReferences(true);
    try {
      const response = await fetch(API_BASE + '/api/reports/' + jobId + '/references.zip', { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('회의 참고자료를 다운로드하지 못했습니다.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(loungeDetail?.title || selectedLoungeReport?.title || 'meeting')}_references.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setLoungeError(err.message);
    } finally {
      setIsDownloadingReferences(false);
    }
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  }

  async function refreshResult(jobId) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/result`);
    if (!response.ok) throw new Error('결과를 불러오지 못했습니다.');
    const data = await response.json();
    setResult(data.result);
    setSpeakerMapping(data.speaker_mapping || {});
    setSpeakerMatches(data.speaker_matches || { matches: [] });
    setMappedSentences(data.refined_result || data.result.sentences || []);
    setSelectedSpeakerFilter('all');
    setModalMode('mapping');
    setModalOpen(true);
  }

  function startPolling(jobId) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (!response.ok) throw new Error('작업 상태를 확인하지 못했습니다.');
        const data = await response.json();
        setJob(data);
        if (data.status === 'completed') {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          await refreshResult(jobId);
        }
        if (data.status === 'failed') {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          setError(data.message || '처리 중 오류가 발생했습니다.');
        }
      } catch (err) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
        setError(err.message);
      }
    }, 2000);
  }

  function addListItem(value, setValue, setItems) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setItems((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setValue('');
  }

  function removeListItem(setItems, index) {
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  function addTeamMemberToParticipants(memberNameValue) {
    const trimmed = memberNameValue.trim();
    if (!trimmed || participants.includes(trimmed)) return;
    setParticipants((prev) => [...prev, trimmed]);
  }

  function addAllTeamMembersToParticipants() {
    setParticipants((prev) => {
      const existing = new Set(prev);
      const nextMembers = members
        .map((member) => member.member_name.trim())
        .filter((memberName) => memberName && !existing.has(memberName));
      return nextMembers.length ? [...prev, ...nextMembers] : prev;
    });
  }

  function handleListKeyDown(event, addItem) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addItem();
  }

  function timePartsToValue(parts) {
    if (!parts.hour) return '';

    let hour = Number(parts.hour);
    if (parts.period === 'AM') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    return String(hour).padStart(2, '0') + ':' + parts.minute;
  }

  function setHalfHourTime(parts, setParts, setValue, key, nextValue) {
    const nextParts = { ...parts, [key]: nextValue };
    setParts(nextParts);
    setValue(timePartsToValue(nextParts));
  }

  function parseStartSeconds(timeRange) {
    const match = String(timeRange || '').match(/([0-9]+(?:\.[0-9]+)?)s/);
    return match ? Number(match[1]) : 0;
  }

  function playSentence(sentence) {
    if (!audioRef.current || !analysisAudioUrl) return;
    audioRef.current.currentTime = parseStartSeconds(sentence.time);
    audioRef.current.play().catch(() => undefined);
  }

  function playLoungeRecapItem(item) {
    if (!loungeAudioRef.current || !loungeAudioUrl) return;
    loungeAudioRef.current.currentTime = parseStartSeconds(item.time);
    loungeAudioRef.current.play().catch(() => undefined);
  }

  function updateSentence(index, updates) {
    setResult((prev) => prev ? {
      ...prev,
      sentences: (prev.sentences || []).map((sentence) => (
        sentence.index === index ? { ...sentence, ...updates } : sentence
      )),
    } : prev);
    setMappedSentences((prev) => prev.map((sentence) => (
      sentence.index === index ? { ...sentence, ...updates } : sentence
    )));
  }

  function removeSentence(index) {
    setResult((prev) => prev ? {
      ...prev,
      sentences: (prev.sentences || []).filter((sentence) => sentence.index !== index),
    } : prev);
    setMappedSentences((prev) => prev.filter((sentence) => sentence.index !== index));
  }

  function openSentenceEditor(sentence) {
    setEditingSentence(sentence);
    setEditingContent(sentence.content || '');
    setEditingSpeaker(String(sentence.speaker ?? ''));
  }

  function saveSentenceEdit() {
    if (!editingSentence) return;
    updateSentence(editingSentence.index, {
      content: editingContent.trim(),
      speaker: editingSpeaker.trim(),
    });
    setEditingSentence(null);
    setEditingContent('');
    setEditingSpeaker('');
  }

  async function handleLogin(event) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      if (!response.ok) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      const data = await response.json();
      setAuthToken(data.token);
      setAuthUser(data.user);
      resetMeetingForm(data.user);
      window.localStorage.setItem('wiameet_token', data.token);
      window.localStorage.setItem('wiameet_user', JSON.stringify(data.user));
      setLoginPassword('');
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    setCurrentView('home');
    setAuthToken('');
    setAuthUser(null);
    window.localStorage.removeItem('wiameet_token');
    window.localStorage.removeItem('wiameet_user');
  }

  function authHeaders() {
    return { Authorization: `Bearer ${authToken}` };
  }

  function authenticatedUrl(path) {
    const separator = path.includes('?') ? '&' : '?';
    return `${API_BASE}${path}${separator}token=${encodeURIComponent(authToken)}`;
  }

  function handleExpiredSession() {
    handleLogout();
    setLoginError('세션이 만료되었습니다. 다시 로그인하세요.');
  }

  async function loadAccounts() {
    setIsLoadingAccounts(true);
    setAccountError('');
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('계정 목록을 불러오지 못했습니다.');
      const data = await response.json();
      setAccountUsers(data.users || []);
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setIsLoadingAccounts(false);
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    setIsCreatingAccount(true);
    setAccountError('');
    setAccountMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(newAccount),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || '계정 추가에 실패했습니다.');
      }
      setNewAccount({ username: '', display_name: '', role: 'user' });
      setAccountMessage('계정을 추가했습니다.');
      await loadAccounts();
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function resetAccountPassword(userUuid) {
    setResettingPasswordId(userUuid);
    setAccountError('');
    setAccountMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/admin/users/${userUuid}/password/reset`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || '비밀번호 초기화에 실패했습니다.');
      }
      setAccountMessage('비밀번호를 초기 비밀번호로 초기화했습니다.');
      await loadAccounts();
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setResettingPasswordId(null);
    }
  }

  async function updateRequiredPassword(event) {
    event.preventDefault();
    setRequiredPasswordError('');
    if (requiredPassword.length < 6) {
      setRequiredPasswordError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (requiredPassword === 'wia1234!') {
      setRequiredPasswordError('초기 비밀번호와 다른 비밀번호를 입력하세요.');
      return;
    }
    if (requiredPassword !== requiredPasswordConfirm) {
      setRequiredPasswordError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setIsUpdatingRequiredPassword(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ password: requiredPassword }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || '비밀번호 설정에 실패했습니다.');
      }
      const data = await response.json();
      setAuthUser(data.user);
      window.localStorage.setItem('wiameet_user', JSON.stringify(data.user));
      setRequiredPassword('');
      setRequiredPasswordConfirm('');
    } catch (err) {
      setRequiredPasswordError(err.message);
    } finally {
      setIsUpdatingRequiredPassword(false);
    }
  }

  async function loadMembers() {
    setIsLoadingMembers(true);
    setMemberError('');
    try {
      const response = await fetch(`${API_BASE}/api/members`, { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('멤버 목록을 불러오지 못했습니다.');
      const data = await response.json();
      setMembers(data.members || []);
    } catch (err) {
      setMemberError(err.message);
    } finally {
      setIsLoadingMembers(false);
    }
  }

  async function createMember(event) {
    event.preventDefault();
    setIsCreatingMember(true);
    setMemberError('');
    setMemberMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ member_name: memberName }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || '멤버 추가에 실패했습니다.');
      }
      setMemberName('');
      setMemberMessage('멤버를 추가했습니다.');
      await loadMembers();
    } catch (err) {
      setMemberError(err.message);
    } finally {
      setIsCreatingMember(false);
    }
  }

  async function persistMemberOrder(nextMembers) {
    setMembers(nextMembers);
    setMemberError('');
    try {
      const response = await fetch(`${API_BASE}/api/members/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ member_uuids: nextMembers.map((member) => member.member_uuid) }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('멤버 위치 변경에 실패했습니다.');
    } catch (err) {
      setMemberError(err.message);
      await loadMembers();
    }
  }

  function handleMemberDragStart(memberUuid) {
    setDraggingMemberUuid(memberUuid);
  }

  function handleMemberDragOver(event) {
    event.preventDefault();
  }

  function handleMemberDrop(targetMemberUuid) {
    if (!draggingMemberUuid || draggingMemberUuid === targetMemberUuid) {
      setDraggingMemberUuid('');
      return;
    }

    const fromIndex = members.findIndex((member) => member.member_uuid === draggingMemberUuid);
    const toIndex = members.findIndex((member) => member.member_uuid === targetMemberUuid);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingMemberUuid('');
      return;
    }

    const nextMembers = [...members];
    const [draggedMember] = nextMembers.splice(fromIndex, 1);
    nextMembers.splice(toIndex, 0, draggedMember);
    setDraggingMemberUuid('');
    persistMemberOrder(nextMembers);
  }

  async function deleteMember(memberUuid) {
    setMemberError('');
    setMemberMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/members/${memberUuid}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('멤버 삭제에 실패했습니다.');
      setMemberMessage('멤버를 삭제했습니다.');
      await loadMembers();
    } catch (err) {
      setMemberError(err.message);
    }
  }

  async function loadCategories() {
    setIsLoadingCategories(true);
    setCategoryError('');
    try {
      const response = await fetch(API_BASE + '/api/categories', { headers: authHeaders() });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('카테고리 목록을 불러오지 못했습니다.');
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setIsLoadingCategories(false);
    }
  }

  async function createCategory(event) {
    event.preventDefault();
    setIsCreatingCategory(true);
    setCategoryError('');
    setCategoryMessage('');
    try {
      const response = await fetch(API_BASE + '/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category_name: categoryName }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || '카테고리 추가에 실패했습니다.');
      }
      setCategoryName('');
      setCategoryMessage('카테고리를 추가했습니다.');
      await loadCategories();
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setIsCreatingCategory(false);
    }
  }

  async function persistCategoryOrder(nextCategories) {
    setCategories(nextCategories);
    setCategoryError('');
    try {
      const response = await fetch(API_BASE + '/api/categories/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category_uuids: nextCategories.map((category) => category.category_uuid) }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('카테고리 위치 변경에 실패했습니다.');
    } catch (err) {
      setCategoryError(err.message);
      await loadCategories();
    }
  }

  function handleCategoryDragStart(categoryUuid) {
    setDraggingCategoryUuid(categoryUuid);
  }

  function handleCategoryDragOver(event) {
    event.preventDefault();
  }

  function handleCategoryDrop(targetCategoryUuid) {
    if (!draggingCategoryUuid || draggingCategoryUuid === targetCategoryUuid) {
      setDraggingCategoryUuid('');
      return;
    }

    const fromIndex = categories.findIndex((category) => category.category_uuid === draggingCategoryUuid);
    const toIndex = categories.findIndex((category) => category.category_uuid === targetCategoryUuid);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingCategoryUuid('');
      return;
    }

    const nextCategories = [...categories];
    const [draggedCategory] = nextCategories.splice(fromIndex, 1);
    nextCategories.splice(toIndex, 0, draggedCategory);
    setDraggingCategoryUuid('');
    persistCategoryOrder(nextCategories);
  }

  async function deleteCategory(categoryUuid) {
    setCategoryError('');
    setCategoryMessage('');
    try {
      const response = await fetch(API_BASE + '/api/categories/' + categoryUuid, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw new Error('카테고리 삭제에 실패했습니다.');
      setCategoryMessage('카테고리를 삭제했습니다.');
      await loadCategories();
    } catch (err) {
      setCategoryError(err.message);
    }
  }

  function updateConfluenceForm(field, value) {
    setConfluenceForm((prev) => ({ ...prev, [field]: field === 'page_url' ? displayConfluenceUrl(value) : value }));
    setConfluenceUiMessage('');
  }

  async function testConfluenceConnection(event) {
    event?.preventDefault();
    setConfluenceError('');
    setConfluenceUiMessage('');
    setIsTestingConfluence(true);
    try {
      const response = await fetch(API_BASE + '/api/confluence-settings/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          page_url: displayConfluenceUrl(confluenceForm.page_url),
          token: confluenceForm.token,
        }),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, 'Confluence 연결 테스트에 실패했습니다.');
      const data = await response.json();
      setConfluenceTestSuccess(data);
    } catch (err) {
      setConfluenceError(err.message);
    } finally {
      setIsTestingConfluence(false);
    }
  }

  async function closeConfluenceSuccessModal() {
    setConfluenceTestSuccess(null);
    await loadConfluenceSettings();
  }


  async function recheckConfluenceConnection() {
    setConfluenceError('');
    setConfluenceUiMessage('');
    setIsTestingConfluence(true);
    try {
      const response = await fetch(API_BASE + '/api/confluence-settings/retest', {
        method: 'POST',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, 'Confluence 연동 체크에 실패했습니다.');
      const data = await response.json();
      setConfluenceTestSuccess(data);
    } catch (err) {
      const message = err.message;
      await loadConfluenceSettings();
      setConfluenceError(message);
    } finally {
      setIsTestingConfluence(false);
    }
  }

  async function disconnectConfluenceConnection() {
    if (!window.confirm('Confluence 연동을 해제할까요? 저장된 Access Token 정보가 삭제됩니다.')) return;
    setConfluenceError('');
    setConfluenceUiMessage('');
    setIsDisconnectingConfluence(true);
    try {
      const response = await fetch(API_BASE + '/api/confluence-settings', {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (response.status === 401) {
        handleExpiredSession();
        return;
      }
      if (!response.ok) throw await apiError(response, 'Confluence 연동 해제에 실패했습니다.');
      setConfluenceForm((prev) => ({ ...prev, page_url: '', token: '', enabled: false }));
      await loadConfluenceSettings();
      setConfluenceUiMessage('Confluence 연동을 해제했습니다.');
    } catch (err) {
      setConfluenceError(err.message);
    } finally {
      setIsDisconnectingConfluence(false);
    }
  }

  async function uploadAndRun() {
    const uploadAudioFile = activeMeetingAudioFile;
    if (!uploadAudioFile) return;
    setError('');
    setResult(null);
    setMappedSentences([]);
    setSpeakerMatches({ matches: [] });
    setSelectedSpeakerFilter('all');
    setReportInstruction('');
    setReportMarkdown('');
    setReportCompleted(false);
    setModalMode('mapping');
    setModalOpen(false);
    setJob({
      job_id: 'uploading',
      status: 'running',
      stage: 'uploading',
      progress: 0,
      message: '녹음 파일을 업로드하는 중입니다.',
      logs: ['[--:--:--]   0% uploading        녹음 파일을 업로드하는 중입니다.'],
    });
    window.requestAnimationFrame(() => processRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

    const formData = new FormData();
    formData.append('audio', uploadAudioFile);
    for (const referenceFile of referenceFiles) {
      formData.append('references', referenceFile);
    }
    formData.append('meeting_title', meetingTitle);
    formData.append('meeting_date', meetingDate);
    formData.append('meeting_start_time', meetingStartTime);
    formData.append('meeting_end_time', meetingEndTime);
    formData.append('meeting_organizations', meetingOrganizations.join('\n'));
    formData.append('participants', participants.join('\n'));
    formData.append('meeting_purpose', meetingPurpose);
    formData.append('meeting_category_uuid', selectedCategory?.category_uuid || '');
    formData.append('meeting_category_name', selectedCategory?.category_name || '');
    formData.append('meeting_reference_text', '');
    const response = await fetch(`${API_BASE}/api/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      setJob(null);
      setError(text || '업로드에 실패했습니다.');
      return;
    }
    const data = await response.json();
    setJob(data);
    startPolling(data.job_id);
  }

  function updateSpeakerName(speakerId, value) {
    setSpeakerMapping((prev) => ({ ...prev, [String(speakerId)]: value }));
  }

  async function saveSpeakerMapping() {
    if (!job?.job_id) return;
    setIsSavingMap(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/speaker-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: speakerMapping, sentences: result?.sentences || [] }),
      });
      if (!response.ok) throw await apiError(response, '화자 매핑 저장에 실패했습니다.');
      const data = await response.json();
      setMappedSentences(data.sentences || []);
      setSpeakerMatches(data.speaker_matches || { matches: [] });
      setModalMode('report_instruction');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingMap(false);
    }
  }

  async function generateMeetingReport() {
    if (!job?.job_id) return;
    setIsGeneratingReport(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ special_instruction: reportInstruction }),
      });
      if (!response.ok) throw await apiError(response, '회의록 생성에 실패했습니다.');
      const data = await response.json();
      setReportMarkdown(data.report_markdown || '');
      setModalMode('report_review');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGeneratingReport(false);
    }
  }

  async function finalizeMeetingReport() {
    if (!job?.job_id) return;
    setIsFinalizingReport(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/report/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_markdown: reportMarkdown }),
      });
      if (!response.ok) throw await apiError(response, '회의록 확정 저장에 실패했습니다.');
      setReportCompleted(true);
      if (isMobileRoute) {
        setModalMode('report_review');
      } else {
        setCurrentView('report');
        setModalOpen(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsFinalizingReport(false);
    }
  }

  function resetMeetingWorkflow() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    resetMeetingForm();
    setJob(null);
    setResult(null);
    setSpeakerMapping({});
    setSpeakerMatches({ matches: [] });
    setMappedSentences([]);
    setSelectedSpeakerFilter('all');
    setError('');
    setModalOpen(false);
    setModalMode('mapping');
    setReportInstruction('');
    setReportMarkdown('');
    setReportCompleted(false);
    setEditingSentence(null);
    setEditingContent('');
    setEditingSpeaker('');
    setIsSavingMap(false);
    setIsGeneratingReport(false);
    setIsFinalizingReport(false);
    setIsCompletingReport(false);
    setCurrentView('create');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  async function completeMeetingReport() {
    if (!job?.job_id) return;
    setIsCompletingReport(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/complete`, {
        method: 'POST',
      });
      if (!response.ok) throw await apiError(response, '회의록 저장 완료 처리에 실패했습니다.');
      resetMeetingWorkflow();
      if (isMobileRoute) {
        await loadLoungeReports();
        navigateMobile('lounge');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCompletingReport(false);
    }
  }



  if (!authUser || !authToken) {
    if (isMobileRoute) {
      return (
        <>
          <MobileLoginPage
            loginUsername={loginUsername}
            setLoginUsername={setLoginUsername}
            loginPassword={loginPassword}
            setLoginPassword={setLoginPassword}
            loginError={loginError}
            isLoggingIn={isLoggingIn}
            onLogin={handleLogin}
            installPromptReady={Boolean(deferredInstallPrompt)}
            isStandalone={isStandaloneApp}
            mobilePlatform={mobilePlatform}
            onInstallApp={installMobileApp}
          />
          {installHelpOpen && (
            <div className="mobile-sheet-backdrop" onClick={() => setInstallHelpOpen(false)}>
              <section className="mobile-install-sheet" onClick={(event) => event.stopPropagation()}>
                <div className="mobile-detail-grip" />
                <div className="mobile-team-sheet-head">
                  <div>
                    <span>Install App</span>
                    <h2>WIAMeet 앱 설치</h2>
                  </div>
                  <button className="mobile-icon-btn" type="button" onClick={() => setInstallHelpOpen(false)}><X size={18} /></button>
                </div>
                {mobilePlatform === 'ios' ? (
                  <div className="mobile-install-help">
                    <p>iPhone에서는 Safari 하단 공유 버튼을 누른 뒤 <b>홈 화면에 추가</b>를 선택하세요.</p>
                    <p>홈 화면에 WIAMeet 아이콘이 생성되고, 다음부터 앱처럼 실행할 수 있습니다.</p>
                  </div>
                ) : (
                  <div className="mobile-install-help">
                    <p>브라우저 메뉴에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.</p>
                    <p>설치 버튼이 보이지 않으면 사내 HTTPS 인증서와 브라우저 설치 조건을 확인해야 합니다.</p>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      );
    }
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-brand">
            <span className="wia-mark login-mark">WIA</span>
            <div>
              <b>WIAMeet</b>
              <p>회의록 자동 작성 워크스페이스</p>
            </div>
          </div>

          <form className="login-card" onSubmit={handleLogin}>
            <div className="login-card-head">
              <span>Account Login</span>
              <h1>WIAMeet 로그인</h1>
            </div>

            <label className="login-field">
              <span>아이디</span>
              <input
                type="text"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                autoComplete="username"
                placeholder="아이디를 입력하세요"
              />
            </label>

            <label className="login-field">
              <span>비밀번호</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="비밀번호를 입력하세요"
              />
            </label>

            {loginError && <div className="login-error">{loginError}</div>}

            <button className="primary-btn login-submit" type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? <span className="btn-spinner" aria-hidden="true"></span> : <LogIn size={16} />}
              {isLoggingIn ? '로그인 중' : '로그인'}
            </button>
          </form>
        </section>
      </main>
    );
  }


  const passwordSetupModal = authUser?.password_reset_required ? (
    <div className="password-required-backdrop">
      <form className="password-required-dialog" onSubmit={updateRequiredPassword}>
        <div className="password-required-head">
          <KeyRound size={22} />
          <div>
            <span>Initial Password</span>
            <h2>비밀번호 설정</h2>
            <p>현재 계정은 초기 비밀번호를 사용 중입니다. 계속 진행하려면 새 비밀번호를 설정하세요.</p>
          </div>
        </div>
        <label className="login-field">
          <span>새 비밀번호</span>
          <input type="password" value={requiredPassword} onChange={(event) => setRequiredPassword(event.target.value)} placeholder="초기 비밀번호와 다른 6자 이상" />
        </label>
        <label className="login-field">
          <span>새 비밀번호 확인</span>
          <input type="password" value={requiredPasswordConfirm} onChange={(event) => setRequiredPasswordConfirm(event.target.value)} placeholder="새 비밀번호 재입력" />
        </label>
        {requiredPasswordError && <div className="login-error">{requiredPasswordError}</div>}
        <button className="primary-btn" type="submit" disabled={isUpdatingRequiredPassword}>
          {isUpdatingRequiredPassword ? <span className="btn-spinner" aria-hidden="true"></span> : <CheckCircle2 size={16} />}
          비밀번호 설정
        </button>
      </form>
    </div>
  ) : null;

  if (isMobileRoute) {
    let mobilePage = null;
    if (mobileView === 'home') {
      mobilePage = (
        <MobileMeetHome
          authUser={authUser}
          homeStats={homeStats}
          onLogout={handleLogout}
          onOpenDesktop={() => { window.location.href = '/'; }}
          onNavigate={navigateMobile}
        />
      );
    } else if (mobileView === 'record') {
      mobilePage = (
        <MobileRecordPage
          recorderSupported={recorderSupported}
          recordingStatus={recordingStatus}
          recordingStatusLabel={recordingStatusLabel}
          recordingSeconds={recordingSeconds}
          recordingBars={recordingBars}
          recordingError={recordingError}
          audioFile={audioFile}
          audioUrl={audioUrl}
          onStart={startBrowserRecording}
          onPauseResume={pauseOrResumeBrowserRecording}
          onStop={stopBrowserRecording}
          onClear={clearRecordedAudio}
          onUseForCreate={useRecordedAudioForMeetingForm}
          onArchive={openDraftSaveDialog}
          archiveSaved={savedDraftAudioKey === audioDraftKey()}
          isArchiving={isSavingDraft}
          archiveMessage={recordingDraftMessage}
          archiveError={recordingDraftError}
        />
      );
    } else if (mobileView === 'create') {
      mobilePage = (
        <MobileCreatePage
          categories={categories}
          selectedCategoryUuid={selectedCategoryUuid}
          setSelectedCategoryUuid={setSelectedCategoryUuid}
          meetingTitle={meetingTitle}
          setMeetingTitle={setMeetingTitle}
          meetingDate={meetingDate}
          setMeetingDate={setMeetingDate}
          meetingStartTime={meetingStartTime}
          setMeetingStartTime={setMeetingStartTime}
          meetingEndTime={meetingEndTime}
          setMeetingEndTime={setMeetingEndTime}
          meetingPurpose={meetingPurpose}
          setMeetingPurpose={setMeetingPurpose}
          meetingOrganizations={meetingOrganizations}
          setMeetingOrganizations={setMeetingOrganizations}
          members={members}
          participants={participants}
          setParticipants={setParticipants}
          audioFile={mobileCreateAudioLinked ? mobileCreateAudioFile : null}
          referenceFiles={referenceFiles}
          setReferenceFiles={setReferenceFiles}
          job={job}
          error={error}
          canStart={mobileCreateAudioLinked && canStart}
          onUploadAndRun={uploadAndRun}
          onOpenRecorder={() => navigateMobile('record')}
          onOpenDraftPicker={openDraftPicker}
          onUnlinkAudio={() => { setMobileCreateAudioLinked(false); setMobileCreateAudioFile(null); }}
        />
      );
    } else if (mobileView === 'lounge') {
      mobilePage = (
        <MobileLoungePage
          isLoadingLounge={isLoadingLounge}
          loungeError={loungeError}
          filteredLoungeReports={filteredLoungeReports}
          loungeCategoryOptions={loungeCategoryOptions}
          loungeCategoryFilter={loungeCategoryFilter}
          setLoungeCategoryFilter={setLoungeCategoryFilter}
          loungeMonthFilter={loungeMonthFilter}
          setLoungeMonthFilter={setLoungeMonthFilter}
          selectedLoungeReport={selectedLoungeReport}
          loungeDetail={loungeDetail}
          loungeAudioUrl={loungeAudioUrl}
          isLoadingLoungeDetail={isLoadingLoungeDetail}
          isLoadingLoungeAudio={isLoadingLoungeAudio}
          loungeAudioRef={loungeAudioRef}
          onOpenReport={openLoungeReport}
          onCloseReport={closeLoungeReport}
          onPlayRecap={playLoungeRecapItem}
        />
      );
    }
    return (
      <>
        <MobileMeetApp current={mobileView} onNavigate={navigateMobile}>{mobilePage}</MobileMeetApp>
        <MobileWorkflowSheet
          open={modalOpen}
          mode={modalMode}
          onClose={() => setModalOpen(false)}
          speakerIds={speakerIds}
          speakerMatches={speakerMatches}
          speakerMapping={speakerMapping}
          onUpdateSpeakerName={updateSpeakerName}
          selectedSpeakerFilter={selectedSpeakerFilter}
          setSelectedSpeakerFilter={setSelectedSpeakerFilter}
          filteredSentences={filteredSentences}
          audioUrl={analysisAudioUrl}
          audioRef={audioRef}
          onPlaySentence={playSentence}
          onOpenSentenceEditor={openSentenceEditor}
          onRemoveSentence={removeSentence}
          reportInstruction={reportInstruction}
          setReportInstruction={setReportInstruction}
          isGeneratingReport={isGeneratingReport}
          reportMarkdown={reportMarkdown}
          setReportMarkdown={setReportMarkdown}
          reportCompleted={reportCompleted}
          error={error}
          editingSentence={editingSentence}
          editingContent={editingContent}
          setEditingContent={setEditingContent}
          editingSpeaker={editingSpeaker}
          setEditingSpeaker={setEditingSpeaker}
          setEditingSentence={setEditingSentence}
          onSaveSentenceEdit={saveSentenceEdit}
          isSavingMap={isSavingMap}
          onSaveSpeakerMapping={saveSpeakerMapping}
          onGenerateReport={generateMeetingReport}
          isFinalizingReport={isFinalizingReport}
          onFinalizeReport={finalizeMeetingReport}
          isCompletingReport={isCompletingReport}
          onCompleteReport={completeMeetingReport}
        />
        {installHelpOpen && (
          <div className="mobile-sheet-backdrop" onClick={() => setInstallHelpOpen(false)}>
            <section className="mobile-install-sheet" onClick={(event) => event.stopPropagation()}>
              <div className="mobile-detail-grip" />
              <div className="mobile-team-sheet-head">
                <div>
                  <span>Install App</span>
                  <h2>WIAMeet 앱 설치</h2>
                </div>
                <button className="mobile-icon-btn" type="button" onClick={() => setInstallHelpOpen(false)}><X size={18} /></button>
              </div>
              {mobilePlatform === 'ios' ? (
                <div className="mobile-install-help">
                  <p>iPhone에서는 Safari 하단 공유 버튼을 누른 뒤 <b>홈 화면에 추가</b>를 선택하세요.</p>
                  <p>홈 화면에 WIAMeet 아이콘이 생성되고, 다음부터 앱처럼 실행할 수 있습니다.</p>
                </div>
              ) : (
                <div className="mobile-install-help">
                  <p>브라우저 메뉴에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.</p>
                  <p>설치 버튼이 보이지 않으면 사내 HTTPS 인증서와 브라우저 설치 조건을 확인해야 합니다.</p>
                </div>
              )}
            </section>
          </div>
        )}
    {draftSaveOpen && (
      <div className="draft-modal-backdrop open" onClick={() => setDraftSaveOpen(false)}>
        <form className="draft-modal" onSubmit={saveRecordingDraft} onClick={(event) => event.stopPropagation()}>
          <div className="draft-modal-head">
            <div>
              <span>Recording Archive</span>
              <h3>녹음 보관</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setDraftSaveOpen(false)}><X size={18} /></button>
          </div>
          <div className="draft-warning-box">보관된 녹음은 7일 간 유지됩니다.</div>
          <label className="login-field">
            <span>제목</span>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="녹음 보관 제목" />
          </label>
          {recordingDraftError && <div className="login-error">{recordingDraftError}</div>}
          <div className="draft-modal-actions">
            <button className="line-btn" type="button" onClick={() => setDraftSaveOpen(false)}>취소</button>
            <button className="primary-btn" type="submit" disabled={isSavingDraft || !draftTitle.trim()}>
              {isSavingDraft && <span className="btn-spinner" aria-hidden="true"></span>}
              {isSavingDraft ? '저장 중' : '저장'}
            </button>
          </div>
        </form>
      </div>
    )}

    {draftPickerOpen && (
      <div className="draft-modal-backdrop open" onClick={() => setDraftPickerOpen(false)}>
        <section className="draft-modal wide" onClick={(event) => event.stopPropagation()}>
          <div className="draft-modal-head">
            <div>
              <span>Recording Archives</span>
              <h3>보관 녹음 불러오기</h3>
              <p>보관된 녹음 파일을 회의록 작성에 연결합니다.</p>
            </div>
            <button className="icon-btn" type="button" onClick={() => setDraftPickerOpen(false)}><X size={18} /></button>
          </div>
          {recordingDraftError && <div className="login-error">{recordingDraftError}</div>}
          <div className="draft-list">
            {isLoadingDrafts && <div className="account-empty">보관 녹음 목록을 불러오는 중입니다.</div>}
            {!isLoadingDrafts && recordingDrafts.map((draft) => (
              <article className={draft.available ? 'draft-list-item' : 'draft-list-item disabled'} key={draft.draft_uuid}>
                <div className="draft-list-main">
                  <div>
                    <b>{draft.title}</b>
                    <small>{formatDurationLabel(draft.duration_seconds)} · {String(draft.created_at || '').slice(0, 16).replace('T', ' ')}</small>
                  </div>
                </div>
                {draft.available ? (
                  <audio className="draft-preview-audio" src={authenticatedUrl(`/api/recording-drafts/${draft.draft_uuid}/audio`)} controls preload="metadata" />
                ) : (
                  <div className="draft-preview-missing">파일을 찾을 수 없습니다.</div>
                )}
                <button className="draft-load-btn" type="button" onClick={() => useRecordingDraft(draft)} disabled={!draft.available}>이 녹음 불러오기</button>
              </article>
            ))}
            {!isLoadingDrafts && recordingDrafts.length === 0 && <div className="account-empty">보관된 녹음이 없습니다.</div>}
          </div>
        </section>
      </div>
    )}

        {passwordSetupModal}
      </>
    );
  }

  return (
    <>
    <div className="portal-shell">
      <aside className="sidebar">
        <div className="side-logo">
          <span className="wia-mark">WIA</span>
          <span className="logo-title">WIAMeet</span>
        </div>
        <nav className="side-nav">
          <button className={`side-item ${currentView === 'home' ? 'active' : ''}`} onClick={() => setCurrentView('home')}><Home size={17} /><span className="side-name">Meet Home</span></button>
          <button className={`side-item ${currentView === 'record' ? 'active' : ''}`} onClick={() => setCurrentView('record')}><Mic2 size={17} /><span className="side-name">회의 녹음</span></button>
          <button className={`side-item ${currentView === 'create' || currentView === 'report' ? 'active' : ''}`} onClick={() => setCurrentView(reportCompleted ? 'report' : 'create')}><FileText size={17} /><span className="side-name">회의록 생성</span></button>
          <button className={`side-item ${currentView === 'lounge' ? 'active' : ''}`} onClick={() => setCurrentView('lounge')}><FileText size={17} /><span className="side-name">회의록 라운지</span></button>
          <button className={`side-item ${currentView === 'settings' ? 'active' : ''}`} onClick={() => { setSettingsTab('members'); setCurrentView('settings'); }}><Settings size={17} /><span className="side-name">설정</span></button>
          <div className={`side-subnav ${currentView === 'settings' ? 'open' : ''}`}>
            <button className={`side-subitem ${currentView === 'settings' && settingsTab === 'members' ? 'active' : ''}`} onClick={() => { setSettingsTab('members'); setCurrentView('settings'); }}>멤버 관리</button>
            <button className={`side-subitem ${currentView === 'settings' && settingsTab === 'categories' ? 'active' : ''}`} onClick={() => { setSettingsTab('categories'); setCurrentView('settings'); }}>카테고리 관리</button>
            <button className={`side-subitem ${currentView === 'settings' && settingsTab === 'confluence' ? 'active' : ''}`} onClick={() => { setSettingsTab('confluence'); setCurrentView('settings'); }}>Confluence 관리</button>
          </div>
          {authUser.role === 'admin' && (
            <button className={`side-item ${currentView === 'accounts' ? 'active' : ''}`} onClick={() => setCurrentView('accounts')}><ShieldCheck size={17} /><span className="side-name">계정 권한</span></button>
          )}
        </nav>
        <div className="side-bottom-actions">
          <button className="side-item side-mobile-app-item" type="button" onClick={() => setMobileAppModalOpen(true)}><Download size={17} /><span className="side-name">모바일 앱 다운로드</span></button>
          <button className="side-item side-guide-item" type="button" onClick={() => setUserGuideOpen(true)}><Info size={17} /><span className="side-name">사용 가이드</span></button>
        </div>
        <div className="side-user">
          <div className="avatar">W</div>
          <div className="side-user-info"><b>{authUser.display_name || authUser.username}</b><span>{authUser.role || 'user'}</span></div>
          <button className="side-logout" aria-label="logout" onClick={handleLogout}><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="main">
        <section className="content">
          {currentView === 'home' && (
            <section className="home-page">
              <div className="home-head welcome-head">
                <div className="welcome-main">
                  <span className="welcome-avatar"><UserRound size={24} /></span>
                  <div>
                    <span>Welcome to WIAMeet</span>
                    <h2>{authUser.display_name || authUser.username}님, 환영합니다.</h2>
                    <p>오늘도 회의 기록을 빠르게 정리하고, 우리 팀의 회의 흐름을 데이터로 확인하세요.</p>
                  </div>
                </div>
                <div className="welcome-actions">
                  <button className="primary-btn" type="button" onClick={() => setCurrentView('create')}>
                    <Plus size={16} />
                    회의록 생성
                  </button>
                  <button className="line-btn welcome-line" type="button" onClick={() => setCurrentView('lounge')}>
                    <FileText size={16} />
                    라운지 열기
                  </button>
                </div>
              </div>

              <div className="home-metric-grid">
                <div className="home-metric-card">
                  <FileText size={18} />
                  <span>전체 회의록</span>
                  <b>{homeStats.totalReports}</b>
                </div>
                <div className="home-metric-card">
                  <CalendarDays size={18} />
                  <span>지난주 월~금 회의</span>
                  <b>{homeStats.lastWeekCount}</b>
                  <small>{homeStats.lastWeekRange}</small>
                </div>
                <div className="home-metric-card">
                  <Trophy size={18} />
                  <span>지난 주 우리팀의 회의 부자</span>
                  <b>{homeStats.topParticipant?.name || '-'}</b>
                  <small>{homeStats.topParticipant ? `${homeStats.topParticipant.count}회 참석` : '지난주 회의에 참석한 팀원이 없습니다.'}</small>
                </div>
                <div className="home-metric-card">
                  <Building2 size={18} />
                  <span>이번 달 현재 최다 회의 조직</span>
                  <b>{homeStats.topOrganization?.name || '-'}</b>
                  <small>{homeStats.topOrganization ? `${homeStats.topOrganization.count}회 · ${homeStats.thisMonthRange}` : '집계할 조직이 없습니다.'}</small>
                </div>
              </div>

              <div className="home-grid">
                <section className="home-panel">
                  <div className="home-panel-head">
                    <div>
                      <span>Category</span>
                      <h3>월별 회의 카테고리 분포</h3>
                    </div>
                    <div className="home-month-control">
                      <button className="icon-line-btn" type="button" onClick={() => moveHomeCategoryMonth(-1)} aria-label="이전달">‹</button>
                      <b>{homeStats.categoryMonth}</b>
                      <button className="icon-line-btn" type="button" onClick={() => moveHomeCategoryMonth(1)} disabled={!canMoveHomeCategoryMonthNext} aria-label="다음달">›</button>
                    </div>
                  </div>
                  <div className="home-chart-list">
                    {homeStats.categoryRank.map((category) => {
                      const percent = homeStats.categoryMonthTotal ? Math.round((category.count / homeStats.categoryMonthTotal) * 100) : 0;
                      return (
                        <div className="home-chart-row" key={category.name}>
                          <div className="home-chart-label"><b>{category.name}</b><span>{category.count}건</span></div>
                          <div className="home-chart-track"><span style={{ width: `${percent}%` }} /></div>
                        </div>
                      );
                    })}
                    {homeStats.categoryRank.length === 0 && <div className="home-empty">선택한 월에 집계할 회의록이 없습니다.</div>}
                  </div>
                </section>

                <section className="home-panel">
                  <div className="home-panel-head">
                    <div>
                      <span>Recent</span>
                      <h3>최근 회의록</h3>
                    </div>
                  </div>
                  <div className="home-recent-list">
                    {homeStats.recentReports.map((report) => (
                      <button className="home-recent-row" type="button" key={report.report_uuid} onClick={() => openLoungeReport(report)}>
                        <div>
                          <b>{report.title}</b>
                          <span>{report.category_name || '카테고리 미지정'} · 참가 {(report.participants || []).length}명</span>
                        </div>
                        <small>{report.meeting_date || '-'} · {report.start_time || '--:--'}</small>
                      </button>
                    ))}
                    {homeStats.recentReports.length === 0 && <div className="home-empty">최근 회의록이 없습니다.</div>}
                  </div>
                </section>
              </div>
            </section>
          )}

          {currentView === 'record' && (
            <section className="record-page">
              <div className="record-head">
                <div>
                  <span>Browser Recorder</span>
                  <h2>회의 녹음</h2>
                  <p>현재 접속한 컴퓨터의 마이크로 회의를 녹음하고, 녹음 파일을 회의록 생성에 바로 사용할 수 있습니다.</p>
                </div>
              </div>

              <div className="record-panel">
                <div className={`record-widget ${recordingStatus === 'recording' ? 'active' : ''}`}>
                  <div className="record-accent" />
                  <div className="record-widget-body">
                    <div className="record-widget-status">
                      <div className="record-status-label">
                        <span className={`record-status-dot ${recordingStatus}`}>
                          {recordingStatus === 'recording' && <span></span>}
                        </span>
                        <b>{recordingStatusLabel}</b>
                      </div>
                      {recordingStatus === 'stopped' && <span className="record-saved-badge">저장됨</span>}
                    </div>

                    <div className="record-timer">
                      <span>{formatRecordingDuration(recordingSeconds).minutes}</span>
                      <em>:</em>
                      <span>{formatRecordingDuration(recordingSeconds).seconds}</span>
                    </div>

                    <div className={`record-waveform ${recordingStatus === 'recording' ? 'active' : ''}`}>
                      {recordingBars.map((height, index) => (
                        <i key={index} style={{ height: recordingStatus === 'recording' ? `${height}px` : '6px', opacity: recordingStatus === 'recording' ? 0.55 + (height / 40) * 0.45 : 1 }} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="record-actions refined">
                  {recordingStatus === 'idle' && (
                    <button className="primary-btn" type="button" onClick={startBrowserRecording} disabled={!recorderSupported}>
                      <Mic2 size={17} />녹음 시작
                    </button>
                  )}

                  {(recordingStatus === 'recording' || recordingStatus === 'paused') && (
                    <>
                      <button className="line-btn" type="button" onClick={pauseOrResumeBrowserRecording}>
                        {recordingStatus === 'recording' ? <Pause size={17} /> : <Play size={17} />}
                        {recordingStatus === 'recording' ? '일시정지' : '재개'}
                      </button>
                      <button className="primary-btn danger" type="button" onClick={stopBrowserRecording}>
                        <Square size={15} fill="currentColor" />녹음 종료
                      </button>
                    </>
                  )}

                  {recordingStatus === 'stopped' && (
                    <button className="primary-btn" type="button" onClick={startBrowserRecording}>
                      <Mic2 size={17} />새로 녹음
                    </button>
                  )}

                  <button className="line-btn muted" type="button" onClick={() => setConfirmClearRecording(true)} disabled={!recordingHasContent}>
                    <Trash2 size={16} />비우기
                  </button>
                </div>

                {confirmClearRecording && (
                  <div className="record-clear-confirm">
                    <AlertTriangle size={16} />
                    <div>
                      <b>녹음 파일을 비우시겠어요?</b>
                      <p>이 작업은 되돌릴 수 없습니다.</p>
                      <div>
                        <button className="primary-btn danger compact" type="button" onClick={clearRecordedAudio}>비우기</button>
                        <button className="line-btn compact" type="button" onClick={() => setConfirmClearRecording(false)}>취소</button>
                      </div>
                    </div>
                  </div>
                )}

                {recordingError && <div className="error-box">{recordingError}</div>}
                {!recorderSupported && <div className="error-box">현재 브라우저가 마이크 녹음을 지원하지 않습니다.</div>}

                {audioFile && (
                  <div className="record-preview">
                    <div>
                      <span>녹음 파일</span>
                      <b>{audioFile.name}</b>
                    </div>
                    <audio src={audioUrl} controls preload="metadata" />
                    <div className="record-preview-actions three">
                      <button className="primary-btn" type="button" onClick={useRecordedAudioForMeetingForm} disabled={isSavingDraft}>
                        {isSavingDraft ? <span className="btn-spinner" aria-hidden="true"></span> : <FileText size={16} />}
                        {isSavingDraft ? '녹음 보관 중' : '회의록 생성으로 이동'}
                      </button>
                      <button className="line-btn" type="button" onClick={openDraftSaveDialog} disabled={savedDraftAudioKey === audioDraftKey()}>
                        <CheckCircle2 size={16} />{savedDraftAudioKey === audioDraftKey() ? '보관 완료' : '녹음 보관'}
                      </button>
                      <button className="line-btn" type="button" onClick={downloadRecordedAudio}>
                        <Download size={16} />다운로드
                      </button>
                    </div>
                    {recordingDraftMessage && <div className="record-draft-message">{recordingDraftMessage}</div>}
                    {recordingDraftError && <div className="record-draft-error">{recordingDraftError}</div>}
                  </div>
                )}
              </div>
            </section>
          )}

          {currentView === 'create' && (
          <div className="meeting-layout">
            <section className="agent-panel">
              <div className="agent-header">
                <div className="eyebrow">WIAMeet</div>
                <div className="agent-title-row">
                  <h2>회의록 생성</h2>
                  <button className="process-guide-button" type="button" onClick={() => setProcessGuideOpen(true)}>
                    <Info size={16} />
                    <span>회의록 생성 프로세스</span>
                  </button>
                </div>
                <p>회의 기본 정보와 녹음 파일을 바탕으로 회의록을 작성합니다.</p>
              </div>

              <div className="agent-body">
                <div className="form-section">
                  <div className="field-row meeting-title-row">
                    <div className="field-group meeting-title-field">
                      <label className="field-label">회의명 <span className="required">필수</span></label>
                      <input
                        type="text"
                        value={meetingTitle}
                        onChange={(event) => setMeetingTitle(event.target.value)}
                        placeholder="예) 2025 Q3 전략 기획 회의"
                      />
                    </div>
                    <div className="field-group meeting-category-field">
                      <label className="field-label">회의 카테고리 <span className="required">필수</span></label>
                      <select value={selectedCategoryUuid} onChange={(event) => setSelectedCategoryUuid(event.target.value)}>
                        <option value="" disabled>카테고리를 선택하세요.</option>
                        {categories.map((category) => (
                          <option value={category.category_uuid} key={category.category_uuid}>{category.category_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="field-group full meeting-purpose-field">
                    <label className="field-label">회의 목적 <span className="required">필수</span></label>
                    <textarea
                      value={meetingPurpose}
                      onChange={(event) => setMeetingPurpose(event.target.value)}
                      placeholder="예) 하반기 DX 추진 방향을 정리하고 주요 실행 과제를 확정합니다."
                      rows={3}
                    />
                  </div>

                  <div className="field-row triple meeting-time-row">
                    <div className="field-group">
                      <label className="field-label"><CalendarDays size={14} />회의 일자 <span className="required">필수</span></label>
                      <input
                        type="date"
                        value={meetingDate}
                        onChange={(event) => setMeetingDate(event.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label"><Clock3 size={14} />시작 시간 <span className="required">필수</span></label>
                      <div className="time-select-row">
                        <select
                          value={meetingStartTimeParts.period}
                          onChange={(event) => setHalfHourTime(meetingStartTimeParts, setMeetingStartTimeParts, setMeetingStartTime, 'period', event.target.value)}
                        >
                          <option value="AM">오전</option>
                          <option value="PM">오후</option>
                        </select>
                        <select
                          value={meetingStartTimeParts.hour}
                          onChange={(event) => setHalfHourTime(meetingStartTimeParts, setMeetingStartTimeParts, setMeetingStartTime, 'hour', event.target.value)}
                        >
                          <option value="" disabled>시</option>
                          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
                            <option value={hour} key={`start-hour-${hour}`}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={meetingStartTimeParts.minute}
                          onChange={(event) => setHalfHourTime(meetingStartTimeParts, setMeetingStartTimeParts, setMeetingStartTime, 'minute', event.target.value)}
                        >
                          <option value="00">00</option>
                          <option value="30">30</option>
                        </select>
                      </div>
                    </div>
                    <div className="field-group">
                      <label className="field-label"><Clock3 size={14} />종료 시간 <span className="required">필수</span></label>
                      <div className="time-select-row">
                        <select
                          value={meetingEndTimeParts.period}
                          onChange={(event) => setHalfHourTime(meetingEndTimeParts, setMeetingEndTimeParts, setMeetingEndTime, 'period', event.target.value)}
                        >
                          <option value="AM">오전</option>
                          <option value="PM">오후</option>
                        </select>
                        <select
                          value={meetingEndTimeParts.hour}
                          onChange={(event) => setHalfHourTime(meetingEndTimeParts, setMeetingEndTimeParts, setMeetingEndTime, 'hour', event.target.value)}
                        >
                          <option value="" disabled>시</option>
                          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
                            <option value={hour} key={`end-hour-${hour}`}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={meetingEndTimeParts.minute}
                          onChange={(event) => setHalfHourTime(meetingEndTimeParts, setMeetingEndTimeParts, setMeetingEndTime, 'minute', event.target.value)}
                        >
                          <option value="00">00</option>
                          <option value="30">30</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="field-row participant-row">
                    <div className="field-group">
                      <label className="field-label">회의 참석 조직 <span className="required">필수</span></label>
                      <div className="tag-input-wrap">
                        <input
                          className="tag-input-inner"
                          value={organizationInput}
                          onChange={(event) => setOrganizationInput(event.target.value)}
                          onKeyDown={(event) => handleListKeyDown(event, () => addListItem(organizationInput, setOrganizationInput, setMeetingOrganizations))}
                          placeholder="조직명 입력 후 Enter"
                        />
                        <button
                          type="button"
                          className="tag-add-btn"
                          onClick={() => addListItem(organizationInput, setOrganizationInput, setMeetingOrganizations)}
                          aria-label="참석 조직 추가"
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <div className="tag-list card-list">
                        {meetingOrganizations.length === 0 && <div className="empty-list-row">추가된 참석 조직이 없습니다.</div>}
                        {meetingOrganizations.map((organization, index) => (
                          <div className="list-card-row" key={`${organization}-${index}`}>
                            <span className="list-card-icon team"><Building2 size={15} /></span>
                            <span className="list-card-text">{organization}</span>
                            <button type="button" onClick={() => removeListItem(setMeetingOrganizations, index)} aria-label={`${organization} 삭제`}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="field-group">
                      <div className="participant-header-grid">
                        <label className="field-label">회의 참석자 명단 <span className="required">필수</span></label>
                        <div className="field-label participant-quick-label">
                          <span>우리 팀 간편 추가</span>
                          <button
                            type="button"
                            className="team-add-all-btn"
                            onClick={addAllTeamMembersToParticipants}
                            disabled={!members.some((member) => !participants.includes(member.member_name))}
                          >
                            전체 추가
                          </button>
                        </div>
                      </div>
                      <div className="participant-list-grid participant-entry-grid">
                        <div className="participant-list-pane">
                          <div className="tag-input-wrap">
                            <input
                              className="tag-input-inner"
                              value={participantInput}
                              onChange={(event) => setParticipantInput(event.target.value)}
                              onKeyDown={(event) => handleListKeyDown(event, () => addListItem(participantInput, setParticipantInput, setParticipants))}
                              placeholder="소속/이름/직책 입력 후 Enter"
                            />
                            <button
                              type="button"
                              className="tag-add-btn"
                              onClick={() => addListItem(participantInput, setParticipantInput, setParticipants)}
                              aria-label="참석자 추가"
                            >
                              <Plus size={15} />
                            </button>
                          </div>

                          <div className="tag-list card-list compact-card-list">
                            {participants.length === 0 && <div className="empty-list-row">추가된 참석자가 없습니다.</div>}
                            {participants.map((participant, index) => {
                              const isTeamMember = members.some((member) => member.member_name === participant);
                              return (
                                <div className="list-card-row" key={participant + '-' + index}>
                                  <span className={isTeamMember ? 'list-card-icon team-member-icon' : 'list-card-icon person'}><UserRound size={15} /></span>
                                  <span className="list-card-text">{participant}</span>
                                  <button type="button" onClick={() => removeListItem(setParticipants, index)} aria-label={participant + ' 삭제'}>
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="participant-list-pane">
                          <div className="team-member-list team-member-list-aligned">
                            {members.length === 0 && <div className="empty-list-row">설정에서 멤버를 추가하세요.</div>}
                            {members.map((member) => {
                              const alreadyAdded = participants.includes(member.member_name);
                              return (
                                <button
                                  className={alreadyAdded ? 'team-member-card disabled' : 'team-member-card'}
                                  type="button"
                                  key={member.member_uuid}
                                  onClick={() => addTeamMemberToParticipants(member.member_name)}
                                  disabled={alreadyAdded}
                                >
                                  <span className="list-card-icon team-member-icon"><UserRound size={15} /></span>
                                  <span className="list-card-text">{member.member_name}</span>
                                  <span className="team-member-status">{alreadyAdded ? '추가됨' : '+'}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="upload-row">
                    <div className="upload-col">
                      <div className="field-label-row">
                        <label className="field-label">회의 녹음</label>
                      </div>
                      <button className="record-upload-card" type="button" onClick={openRecorderFromMeetingForm}>
                        <span className="record-upload-icon"><Mic2 size={24} /></span>
                        <b>회의 녹음</b>
                        <small>마이크로 바로 녹음</small>
                      </button>
                    </div>

                    <div className="upload-col">
                      <div className="field-label-row">
                        <label className="field-label">회의 녹음 파일 <span className="required">필수</span></label>
                        <button className="team-add-all-btn" type="button" onClick={openDraftPicker}>보관 녹음 불러오기</button>
                      </div>
                      <label className="upload-box">
                        <input
                          type="file"
                          accept="audio/*,.webm,.m4a,.wav,.mp3,.aac,.flac,.ogg"
                          onChange={(event) => setPcCreateAudioFile(event.target.files?.[0] || null)}
                        />
                        <UploadCloud className="upload-icon" size={34} />
                        <b>{pcCreateAudioFile ? pcCreateAudioFile.name : '녹음 파일을 선택하거나 끌어오세요'}</b>
                        <span>webm, m4a, wav, mp3, aac, flac, ogg 파일을 업로드할 수 있습니다.</span>
                      </label>
                    </div>

                    <div className="upload-col">
                      <div className="field-label-row">
                        <label className="field-label">회의 참고자료 <span className="optional">선택</span></label>
                      </div>
                      <label className="upload-box">
                        <input
                          type="file"
                          accept=".ppt,.pptx,.pdf"
                          multiple
                          onChange={(event) => setReferenceFiles(Array.from(event.target.files || []))}
                        />
                        <FileText className="upload-icon" size={34} />
                        <b>{referenceFiles.length > 0 ? `${referenceFiles.length}개 참고자료 선택됨` : '참고자료를 선택하거나 끌어오세요'}</b>
                        <span>{referenceFiles.length > 0 ? referenceFiles.map((file) => file.name).join(', ') : 'PPT, PPTX, PDF 파일을 여러 개 첨부할 수 있습니다.'}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="section-divider" />

                {!job && (
                  <>
                    {error && <div className="error-box">{error}</div>}
                    <div className="action-row start-only-row">
                      <div className="helper">회의명, 회의 카테고리, 회의 목적, 회의 일자, 시작/종료 시간, 참석 조직, 참석자, 녹음 파일은 필수입니다.</div>
                      <button className="primary-btn" disabled={!canStart} onClick={uploadAndRun}><Play size={16} />회의록 분석</button>
                    </div>
                  </>
                )}

                {job && (
                  <div className="process-view" ref={processRef}>
                    <div className="pipeline-grid extended">
                      <div className="pipeline-step active"><span>1</span><b>Upload</b><small>녹음 파일 첨부</small></div>
                      <div className={`pipeline-step ${job ? 'active' : ''}`}><span>2</span><b>Diarization</b><small>화자 분리와 병합</small></div>
                      <div className={`pipeline-step ${job?.progress >= 45 ? 'active' : ''}`}><span>3</span><b>STT</b><small>Qwen3-ASR 변환</small></div>
                      <div className={`pipeline-step ${job?.progress >= 90 ? 'active' : ''}`}><span>4</span><b>Correction</b><small>문맥 기반 교정</small></div>
                      <div className={`pipeline-step ${job?.progress >= 95 ? 'active' : ''}`}><span>5</span><b>Matching</b><small>화자 자동 매칭</small></div>
                      <div className={`pipeline-step ${job?.status === 'completed' ? 'active' : ''}`}><span>6</span><b>Review</b><small>매핑 확인</small></div>
                    </div>

                    <div className="log-console" aria-label="processing logs">
                      <div className="log-console-head">
                        <span></span>
                        <span></span>
                        <span></span>
                        <b>WIAMeet Interpreter</b>
                      </div>
                      <div className="log-console-body" ref={logBodyRef}>
                        {(job.logs || []).map((line, index) => (
                          <div className="log-line" key={`${line}-${index}`}>{line}</div>
                        ))}
                        {(!job.logs || job.logs.length === 0) && <div className="log-line muted">waiting for logs...</div>}
                      </div>
                    </div>

                    {error && <div className="error-box">{error}</div>}

                    <div className="action-row">
                      <div className="helper">{reportCompleted ? '회의록 생성이 완료되었습니다.' : '처리 완료 후 화자 매핑 확인 팝업이 자동으로 열립니다.'}</div>
                      <div className="button-row">
                        {result && <button className="line-btn" onClick={() => { setModalMode(reportCompleted ? 'report_review' : 'mapping'); setModalOpen(true); }}><Pencil size={16} />{reportCompleted ? '회의록 확인' : '화자 매핑 수정'}</button>}
                      </div>
                    </div>

                    {reportCompleted && (
                      <div className="report-complete-panel">
                        <CheckCircle2 size={18} />
                        <div>
                          <b>회의록 생성이 완료되었습니다.</b>
                          <span>확정된 회의록은 작업 폴더에 meeting_report.md로 저장되었습니다.</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

          </div>
          )}

          {currentView === 'report' && (
            <section className="report-page">
              <div className="report-page-head">
                <div>
                  <span>Generated Minutes</span>
                  <h2>{meetingTitle || '회의록'}</h2>
                  <p>확정된 회의록을 마크다운 형식으로 확인합니다.</p>
                </div>
                <div className="report-page-actions">
                  <button className="line-btn" onClick={() => { setModalMode('report_review'); setModalOpen(true); }}><Pencil size={16} />수정</button>
                  <button className="primary-btn" onClick={completeMeetingReport} disabled={isCompletingReport}>
                    {isCompletingReport ? <span className="btn-spinner" aria-hidden="true"></span> : <CheckCircle2 size={16} />}
                    {isCompletingReport ? '저장 중' : '완료'}
                  </button>
                </div>
              </div>
              <MarkdownReport markdown={reportMarkdown} />
            </section>
          )}

          {currentView === 'lounge' && (
            <section className="lounge-page">
              <div className="lounge-page-head">
                <div>
                  <span>Report Lounge</span>
                  <h2>회의록 라운지</h2>
                </div>
                <div className="lounge-filter-row">
                  <label className="lounge-filter">
                    <span>회의 카테고리</span>
                    <select value={loungeCategoryFilter} onChange={(event) => setLoungeCategoryFilter(event.target.value)}>
                      <option value="all">전체 카테고리</option>
                      {loungeCategoryOptions.map((category) => (
                        <option value={category.value} key={category.value}>{category.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lounge-filter lounge-month-filter">
                    <span>회의 월</span>
                    <div className="lounge-month-input-row">
                      <input type="month" value={loungeMonthFilter} onChange={(event) => setLoungeMonthFilter(event.target.value)} />
                      <button className="line-btn compact" type="button" onClick={() => setLoungeMonthFilter('')} disabled={!loungeMonthFilter}>전체</button>
                    </div>
                  </label>
                </div>
              </div>

              <div className="lounge-list-wrap">
                {loungeError && <div className="error-box">{loungeError}</div>}
                {isLoadingLounge && <div className="lounge-state">회의록을 불러오는 중입니다.</div>}
                {!isLoadingLounge && groupedLoungeReports.length === 0 && (
                  <div className="lounge-empty inline">
                    <FileText size={34} />
                    <h2>회의록 라운지</h2>
                    <p>{loungeReports.length === 0 ? '아직 표시할 회의록 목록이 없습니다.' : '선택한 필터에 해당하는 회의록이 없습니다.'}</p>
                  </div>
                )}
                {!isLoadingLounge && groupedLoungeReports.map((group) => (
                  <section className="lounge-day-group" key={group.date}>
                    <div className="lounge-day-head">
                      <CalendarDays size={16} />
                      <b>{group.date}</b>
                    </div>
                    <div className="lounge-report-list">
                      {group.reports.map((report) => (
                        <div className="lounge-report-row" key={report.report_uuid}>
                          <button className="lounge-report-open" type="button" onClick={() => openLoungeReport(report)}>
                            <div>
                              <b>{report.title}</b>
                              <span>{report.category_name || '카테고리 미지정'} · 참가 {(report.participants || []).length}명 · {report.start_time || '--:--'} - {report.end_time || '--:--'}</span>
                            </div>
                          </button>
                          <button
                            className="lounge-report-delete-btn"
                            type="button"
                            onClick={() => deleteLoungeReport(report)}
                            disabled={deletingReportId === report.job_id}
                            title="회의록 삭제"
                            aria-label="회의록 삭제"
                          >
                            {deletingReportId === report.job_id ? <span className="btn-spinner blue" aria-hidden="true"></span> : <Trash2 size={15} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}


          {currentView === "settings" && (
            <section className="settings-page">
              <div className="settings-page-head">
                <div>
                  <span>Workspace Settings</span>
                  <h2>{settingsTitle}</h2>
                  <p>{settingsDescription}</p>
                </div>
              </div>

              {settingsTab === "members" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <UserRound size={18} />
                  <div>
                    <h3>멤버 관리</h3>
                    <p>회의 참석자 빠른 추가에 사용할 우리 팀 인원을 관리합니다.</p>
                  </div>
                </div>
                <div className="settings-grid">
                  <form className="member-create-panel" onSubmit={createMember}>
                    <div className="account-panel-head">
                      <UserPlus size={18} />
                      <b>멤버 추가</b>
                    </div>
                    <label className="account-field">
                      <span>멤버 이름 (소속/이름/직급)</span>
                      <input value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="예) OO팀 OOO 책임매니저" />
                    </label>
                    <button className="primary-btn" type="submit" disabled={isCreatingMember}>
                      {isCreatingMember ? <span className="btn-spinner" aria-hidden="true"></span> : <Plus size={16} />}
                      멤버 추가
                    </button>
                  </form>

                  <section className="member-list-panel">
                    <div className="account-panel-head">
                      <UserRound size={18} />
                      <b>멤버 리스트</b>
                      <button className="line-btn account-refresh" type="button" onClick={loadMembers} disabled={isLoadingMembers}>새로고침</button>
                    </div>
                    {memberError && <div className="error-box account-alert">{memberError}</div>}
                    {memberMessage && <div className="account-message">{memberMessage}</div>}
                    <div className="member-list">
                      {members.map((member) => (
                        <div
                          className={draggingMemberUuid === member.member_uuid ? "member-row dragging" : "member-row"}
                          key={member.member_uuid}
                          draggable
                          onDragStart={() => handleMemberDragStart(member.member_uuid)}
                          onDragOver={handleMemberDragOver}
                          onDrop={() => handleMemberDrop(member.member_uuid)}
                          onDragEnd={() => setDraggingMemberUuid("")}
                        >
                          <div className="account-user-main">
                            <span className="member-drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
                            <span className="account-avatar"><UserRound size={15} /></span>
                            <div>
                              <b>{member.member_name}</b>
                              <small>드래그해서 순서를 변경할 수 있습니다.</small>
                            </div>
                          </div>
                          <div className="member-actions">
                            <button className="line-btn danger-line-btn" type="button" onClick={() => deleteMember(member.member_uuid)}><Trash2 size={15} />삭제</button>
                          </div>
                        </div>
                      ))}
                      {!isLoadingMembers && members.length === 0 && <div className="account-empty">등록된 멤버가 없습니다.</div>}
                      {isLoadingMembers && <div className="account-empty">멤버 목록을 불러오는 중입니다.</div>}
                    </div>
                  </section>
                </div>
              </div>
              )}

              {settingsTab === "categories" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <Tags size={18} />
                  <div>
                    <h3>카테고리 관리</h3>
                    <p>회의록을 분류할 카테고리를 관리합니다.</p>
                  </div>
                </div>
                <div className="settings-grid">
                  <form className="member-create-panel" onSubmit={createCategory}>
                    <div className="account-panel-head">
                      <Tags size={18} />
                      <b>카테고리 추가</b>
                    </div>
                    <label className="account-field">
                      <span>카테고리 이름</span>
                      <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="예) 내부 주간회의" />
                    </label>
                    <button className="primary-btn" type="submit" disabled={isCreatingCategory}>
                      {isCreatingCategory ? <span className="btn-spinner" aria-hidden="true"></span> : <Plus size={16} />}
                      카테고리 추가
                    </button>
                  </form>

                  <section className="member-list-panel">
                    <div className="account-panel-head">
                      <Tags size={18} />
                      <b>카테고리 리스트</b>
                      <button className="line-btn account-refresh" type="button" onClick={loadCategories} disabled={isLoadingCategories}>새로고침</button>
                    </div>
                    {categoryError && <div className="error-box account-alert">{categoryError}</div>}
                    {categoryMessage && <div className="account-message">{categoryMessage}</div>}
                    <div className="member-list">
                      {categories.map((category) => (
                        <div
                          className={draggingCategoryUuid === category.category_uuid ? "member-row dragging" : "member-row"}
                          key={category.category_uuid}
                          draggable
                          onDragStart={() => handleCategoryDragStart(category.category_uuid)}
                          onDragOver={handleCategoryDragOver}
                          onDrop={() => handleCategoryDrop(category.category_uuid)}
                          onDragEnd={() => setDraggingCategoryUuid("")}
                        >
                          <div className="account-user-main">
                            <span className="member-drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
                            <span className="account-avatar category-avatar"><Tags size={15} /></span>
                            <div>
                              <b>{category.category_name}</b>
                              <small>드래그해서 순서를 변경할 수 있습니다.</small>
                            </div>
                          </div>
                          <div className="member-actions">
                            <button className="line-btn danger-line-btn" type="button" onClick={() => deleteCategory(category.category_uuid)}><Trash2 size={15} />삭제</button>
                          </div>
                        </div>
                      ))}
                      {!isLoadingCategories && categories.length === 0 && <div className="account-empty">등록된 카테고리가 없습니다.</div>}
                      {isLoadingCategories && <div className="account-empty">카테고리 목록을 불러오는 중입니다.</div>}
                    </div>
                  </section>
                </div>
              </div>
              )}

              {settingsTab === "confluence" && (
              <div className="settings-section">
                <div className="confluence-stack">
                {isLoadingConfluenceSettings && <div className="confluence-status-card neutral">Confluence 연동 상태를 확인하는 중입니다.</div>}
                {confluenceError && <div className="error-box account-alert">{confluenceError}</div>}
                {!isLoadingConfluenceSettings && confluenceSettings?.is_connected && (
                  <div className="confluence-status-card connected">
                    <div>
                      <span>연동 완료</span>
                      <b>Confluence가 연동되었습니다.</b>
                      <p>마지막 연결 테스트가 성공한 계정입니다.</p>
                    </div>
                    <dl>
                      <div><dt>저장 페이지</dt><dd>{displayConfluenceUrl(confluenceSettings.setting?.page_url) || '-'}</dd></div>
                      <div><dt>인증 방식</dt><dd>Access Token</dd></div>
                      <div><dt>마지막 테스트</dt><dd>{confluenceSettings.setting?.last_tested_at ? String(confluenceSettings.setting.last_tested_at).slice(0, 16).replace('T', ' ') : '-'}</dd></div>
                    </dl>
                    <div className="confluence-connected-actions">
                      <button className="line-btn" type="button" onClick={recheckConfluenceConnection} disabled={isTestingConfluence || isDisconnectingConfluence}>
                        {isTestingConfluence && <span className="btn-spinner blue" aria-hidden="true"></span>}
                        {isTestingConfluence ? '체크 중' : '연동 체크'}
                      </button>
                      <button className="line-btn danger-line-btn" type="button" onClick={disconnectConfluenceConnection} disabled={isTestingConfluence || isDisconnectingConfluence}>
                        {isDisconnectingConfluence ? '해제 중' : '연동 해제'}
                      </button>
                    </div>
                  </div>
                )}
                {!isLoadingConfluenceSettings && !confluenceSettings?.is_connected && (
                  <>
                    <div className="confluence-required-note">
                      <b>Confluence 연동이 필요합니다.</b>
                      <p>회의록 저장 페이지 URL과 Access Token을 입력하세요.</p>
                    </div>
                    <form className="confluence-settings-panel" onSubmit={testConfluenceConnection}>
                      <div className="confluence-form-grid">
                        <label className="account-field confluence-wide-field">
                          <span>회의록 저장 페이지 URL</span>
                          <input
                            value={confluenceForm.page_url}
                            onChange={(event) => updateConfluenceForm('page_url', event.target.value)}
                            placeholder="예) https://confluence.hmg-corp.io/spaces/SPACEID/pages/PAGEID"
                          />
                        </label>
                        <label className="account-field confluence-wide-field">
                          <span>Access Token</span>
                          <div className="secret-input-wrap">
                            <input
                              type={showConfluenceToken ? 'text' : 'password'}
                              value={confluenceForm.token}
                              onChange={(event) => updateConfluenceForm('token', event.target.value)}
                              placeholder="Access Token 입력"
                              autoComplete="off"
                            />
                            <button className="secret-toggle-btn" type="button" onClick={() => setShowConfluenceToken((prev) => !prev)} aria-label={showConfluenceToken ? 'Access Token 숨기기' : 'Access Token 보기'}>
                              {showConfluenceToken ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </label>
                      </div>
                      {confluenceUiMessage && <div className="account-message">{confluenceUiMessage}</div>}
                      <div className="confluence-actions">
                        <button className="primary-btn" type="submit" disabled={isTestingConfluence}>
                          {isTestingConfluence && <span className="btn-spinner" aria-hidden="true"></span>}
                          {isTestingConfluence ? '테스트 중' : '연결 테스트'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
                </div>
              </div>
              )}
            </section>
          )}

          {currentView === 'accounts' && authUser.role === 'admin' && (
            <section className="account-page">
              <div className="account-page-head">
                <div>
                  <span>Admin Console</span>
                  <h2>계정 권한</h2>
                  <p>WIAMeet 접속 계정을 추가하고 비밀번호를 변경합니다.</p>
                </div>
              </div>

              <div className="account-grid">
                <form className="account-create-panel" onSubmit={createAccount}>
                  <div className="account-panel-head">
                    <UserPlus size={18} />
                    <b>계정 추가</b>
                  </div>
                  <label className="account-field">
                    <span>아이디</span>
                    <input value={newAccount.username} onChange={(event) => setNewAccount((prev) => ({ ...prev, username: event.target.value }))} placeholder="예) hong" />
                  </label>
                  <label className="account-field">
                    <span>표시 이름</span>
                    <input value={newAccount.display_name} onChange={(event) => setNewAccount((prev) => ({ ...prev, display_name: event.target.value }))} placeholder="예) 홍길동 매니저" />
                  </label>
                  <div className="account-initial-password">초기 비밀번호는 <b>wia1234!</b>로 고정됩니다.</div>
                  <label className="account-field">
                    <span>권한</span>
                    <select value={newAccount.role} onChange={(event) => setNewAccount((prev) => ({ ...prev, role: event.target.value }))}>
                      <option value="user">일반 사용자</option>
                      <option value="admin">관리자</option>
                    </select>
                  </label>
                  <button className="primary-btn" type="submit" disabled={isCreatingAccount}>
                    {isCreatingAccount ? <span className="btn-spinner" aria-hidden="true"></span> : <UserPlus size={16} />}
                    계정 추가
                  </button>
                </form>

                <section className="account-list-panel">
                  <div className="account-panel-head">
                    <ShieldCheck size={18} />
                    <b>계정 목록</b>
                    <button className="line-btn account-refresh" type="button" onClick={loadAccounts} disabled={isLoadingAccounts}>새로고침</button>
                  </div>
                  {accountError && <div className="error-box account-alert">{accountError}</div>}
                  {accountMessage && <div className="account-message">{accountMessage}</div>}
                  <div className="account-list">
                    {accountUsers.map((user) => (
                      <div className="account-row" key={user.user_uuid}>
                        <div className="account-user-main">
                          <span className="account-avatar"><UserRound size={15} /></span>
                          <div>
                            <b>{user.display_name}</b>
                            <small>{user.username} · {user.role === 'admin' ? '관리자' : '일반 사용자'}</small>
                          </div>
                        </div>
                        <div className="account-password-box reset-only">
                          {user.password_reset_required && <span className="reset-required">초기 비밀번호 상태</span>}
                          <button className="line-btn" type="button" onClick={() => resetAccountPassword(user.user_uuid)} disabled={resettingPasswordId === user.user_uuid}>
                            {resettingPasswordId === user.user_uuid ? <span className="btn-spinner blue" aria-hidden="true"></span> : <KeyRound size={15} />}
                            초기화
                          </button>
                        </div>
                      </div>
                    ))}
                    {!isLoadingAccounts && accountUsers.length === 0 && <div className="account-empty">등록된 계정이 없습니다.</div>}
                    {isLoadingAccounts && <div className="account-empty">계정 목록을 불러오는 중입니다.</div>}
                  </div>
                </section>
              </div>
            </section>
          )}
        </section>
      </main>

      <div className={`modal-backdrop ${selectedLoungeReport ? 'open' : ''}`} onClick={closeLoungeReport} />
      <aside className={`lounge-detail-modal ${selectedLoungeReport ? 'open' : ''}`}>
        <div className="lounge-detail-head">
          <div>
            <span>Report Lounge</span>
            <h3>{selectedLoungeReport?.title || '회의록'}</h3>
          </div>
          <div className="lounge-head-actions">
            <button className="line-btn" type="button" onClick={() => setMeetingInfoOpen(true)} disabled={!selectedLoungeReport}>
              <Info size={16} />
              회의 정보 열람
            </button>
            <button className="icon-btn" onClick={closeLoungeReport}><X size={18} /></button>
          </div>
        </div>
        <div className="lounge-detail-body">
          <section className="lounge-markdown-panel">
            {isLoadingLoungeDetail && <div className="lounge-state">회의록을 불러오는 중입니다.</div>}
            {!isLoadingLoungeDetail && <MarkdownReport markdown={loungeDetail?.report_markdown || ''} />}
          </section>
          <section className="lounge-recap-panel">
            <div className="audio-panel lounge-audio-panel">
              <b>회의 오디오</b>
              {loungeAudioUrl ? (
                <audio ref={loungeAudioRef} src={loungeAudioUrl} controls preload="metadata" />
              ) : (
                <div className="audio-empty">{isLoadingLoungeAudio ? '오디오를 불러오는 중입니다.' : '저장된 오디오가 없습니다.'}</div>
              )}
            </div>
            <div className="lounge-meta-box">
              <b>{loungeDetail?.category_name || selectedLoungeReport?.category_name || '카테고리'}</b>
              <span>{loungeDetail?.meeting_date || selectedLoungeReport?.meeting_date} · {loungeDetail?.start_time || selectedLoungeReport?.start_time} - {loungeDetail?.end_time || selectedLoungeReport?.end_time}</span>
            </div>
            <div className="lounge-recap-list">
              <div className="lounge-recap-head">회의록 복기</div>
              {(loungeDetail?.recap || []).map((item, index) => (
                <button className="lounge-recap-item" type="button" key={`${item.index ?? index}-${item.time || ''}`} onClick={() => playLoungeRecapItem(item)}>
                  <div className="lounge-recap-meta">
                    <span className="speaker-badge compact">{item.speaker || item.speaker_id || 'Speaker'}</span>
                    {item.time && <span className="time-pill">{item.time}</span>}
                  </div>
                  <p>{item.content || item.sentence || ''}</p>
                </button>
              ))}
              {!isLoadingLoungeDetail && (!loungeDetail?.recap || loungeDetail.recap.length === 0) && (
                <div className="account-empty">복기할 발화 목록이 없습니다.</div>
              )}
            </div>
          </section>
        </div>
      </aside>

      <div className={`meeting-info-backdrop ${meetingInfoOpen ? 'open' : ''}`} onClick={() => setMeetingInfoOpen(false)} />
      {meetingInfoOpen && (
        <section className="meeting-info-modal" role="dialog" aria-modal="true" aria-label="회의 정보">
          <div className="meeting-info-head">
            <div>
              <span>Meeting Info</span>
              <h3>회의 정보</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setMeetingInfoOpen(false)}><X size={18} /></button>
          </div>
          <div className="meeting-info-body">
            <div className="meeting-info-grid">
              <div className="meeting-info-item wide">
                <span>회의명</span>
                <b>{loungeDetail?.title || selectedLoungeReport?.title || '-'}</b>
              </div>
              <div className="meeting-info-item">
                <span>회의 카테고리</span>
                <b>{loungeDetail?.category_name || selectedLoungeReport?.category_name || '-'}</b>
              </div>
              <div className="meeting-info-item">
                <span>회의 일시</span>
                <b>{loungeDetail?.meeting_date || selectedLoungeReport?.meeting_date || '-'} · {loungeDetail?.start_time || selectedLoungeReport?.start_time || '-'} - {loungeDetail?.end_time || selectedLoungeReport?.end_time || '-'}</b>
              </div>
              <div className="meeting-info-item wide">
                <span>회의 목적</span>
                <p>{loungeDetail?.purpose || selectedLoungeReport?.purpose || loungeDetail?.metadata?.meeting_purpose || '-'}</p>
              </div>
            </div>

            <div className="meeting-info-list-grid">
              <section className="meeting-info-list-card">
                <div className="meeting-info-list-head"><Building2 size={16} /><b>회의 참석 조직</b></div>
                <div className="meeting-info-chip-list">
                  {(loungeDetail?.organizations || selectedLoungeReport?.organizations || []).map((organization) => (
                    <span className="meeting-info-chip" key={organization}><Building2 size={14} />{organization}</span>
                  ))}
                  {!(loungeDetail?.organizations || selectedLoungeReport?.organizations || []).length && <div className="account-empty compact">등록된 조직이 없습니다.</div>}
                </div>
              </section>
              <section className="meeting-info-list-card">
                <div className="meeting-info-list-head"><UserRound size={16} /><b>회의 참석자 명단</b></div>
                <div className="meeting-info-chip-list">
                  {(loungeDetail?.participants || selectedLoungeReport?.participants || []).map((participant) => (
                    <span className="meeting-info-chip person" key={participant}><UserRound size={14} />{participant}</span>
                  ))}
                  {!(loungeDetail?.participants || selectedLoungeReport?.participants || []).length && <div className="account-empty compact">등록된 참석자가 없습니다.</div>}
                </div>
              </section>
            </div>

            <section className="meeting-info-reference-card">
              <div className="meeting-info-list-head">
                <FileText size={16} />
                <b>회의 참고자료</b>
                <button className="line-btn" type="button" onClick={downloadReferenceZip} disabled={!loungeDetail?.has_references || isDownloadingReferences}>
                  {isDownloadingReferences ? <span className="btn-spinner blue" aria-hidden="true"></span> : <Download size={15} />}
                  ZIP 다운로드
                </button>
              </div>
              <div className="reference-file-list">
                {(loungeDetail?.references || []).map((file) => (
                  <div className="reference-file-row" key={file.filename}>
                    <span><FileText size={14} />{file.filename}</span>
                    <small>{formatFileSize(file.size)}</small>
                  </div>
                ))}
                {!(loungeDetail?.references || []).length && <div className="account-empty compact">첨부된 회의 참고자료가 없습니다.</div>}
              </div>
            </section>
          </div>
        </section>
      )}


      {currentView === 'create' && <div className={`process-guide-backdrop ${processGuideOpen ? 'open' : ''}`} onClick={() => setProcessGuideOpen(false)} />}
      {currentView === 'create' && processGuideOpen && (
        <section className="process-guide-modal" role="dialog" aria-modal="true" aria-labelledby="process-guide-title">
          <div className="process-guide-head">
            <div>
              <span>Process Guide</span>
              <h3 id="process-guide-title">회의록 생성 프로세스</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setProcessGuideOpen(false)} aria-label="프로세스 가이드 닫기"><X size={18} /></button>
          </div>
          <div className="process-guide-body">
            <div className="process-flow" aria-label="회의록 생성 프로세스 플로우">
              {creationProcessSteps.map((step, index) => (
                <div className="process-flow-item" key={step}>
                  <div className="process-flow-node">
                    <span>{index + 1}</span>
                    <b>{step}</b>
                  </div>
                  {index < creationProcessSteps.length - 1 && <div className="process-flow-connector" aria-hidden="true" />}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className={`process-guide-backdrop ${mobileAppModalOpen ? 'open' : ''}`} onClick={() => setMobileAppModalOpen(false)} />
      {mobileAppModalOpen && (
        <section className="mobile-app-download-modal" role="dialog" aria-modal="true" aria-labelledby="mobile-app-download-title">
          <div className="process-guide-head">
            <div>
              <span>Mobile App</span>
              <h3 id="mobile-app-download-title">모바일 앱 다운로드</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setMobileAppModalOpen(false)} aria-label="모바일 앱 다운로드 닫기"><X size={18} /></button>
          </div>
          <div className="mobile-app-download-body">
            <div className="mobile-app-qr-panel">
              <div className="mobile-app-qr-card">
                {mobileAppQrUrl ? <img src={mobileAppQrUrl} alt="WIAMeet 모바일 접속 QR" /> : <div className="mobile-app-qr-empty">QR 생성 중</div>}
              </div>
              <span>사내 와이파이 연결 필요</span>
            </div>
            <div className="mobile-app-download-copy">
              <h4>모바일에서 WIAMeet을 앱처럼 실행하세요.</h4>
              <p>QR을 스캔하면 모바일 로그인 화면이 열리고, 바로 앱 설치 안내를 확인할 수 있습니다.</p>
              <div className="mobile-app-step-list">
                <div><span>1</span><b>QR 스캔</b><small>휴대폰 카메라로 접속</small></div>
                <div><span>2</span><b>앱 설치</b><small>홈 화면 아이콘 추가</small></div>
              </div>
              <div className="mobile-app-note">Android는 설치 버튼을, iPhone은 홈 화면 추가 안내를 로그인 화면에서 제공합니다.</div>
            </div>
          </div>
        </section>
      )}

      <div className={`process-guide-backdrop ${userGuideOpen ? 'open' : ''}`} onClick={() => setUserGuideOpen(false)} />
      {userGuideOpen && (
        <section className="process-guide-modal usage-guide-modal" role="dialog" aria-modal="true" aria-labelledby="usage-guide-title">
          <div className="process-guide-head usage-guide-head">
            <div>
              <span>Guide</span>
              <h3 id="usage-guide-title">사용 가이드</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setUserGuideOpen(false)} aria-label="사용 가이드 닫기"><X size={18} /></button>
          </div>
          <div className="process-guide-body usage-guide-body">
            <article className="usage-guide-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{USER_GUIDE_MARKDOWN}</ReactMarkdown>
            </article>
          </div>
        </section>
      )}

      {confluenceTestSuccess && (
        <div className="draft-modal-backdrop open" onClick={closeConfluenceSuccessModal}>
          <section className="draft-modal confluence-success-modal" role="dialog" aria-modal="true" aria-label="Confluence 연결 테스트 성공" onClick={(event) => event.stopPropagation()}>
            <div className="draft-modal-head">
              <div>
                <span>Connection Test</span>
                <h3>Confluence 연결 성공</h3>
                <p>입력한 Access Token으로 저장 페이지 접근을 확인했습니다.</p>
              </div>
              <button className="icon-btn" type="button" onClick={closeConfluenceSuccessModal} aria-label="Confluence 연결 성공 닫기"><X size={18} /></button>
            </div>
            <div className="confluence-success-body">
              <CheckCircle2 size={26} />
              <div>
                <b>{confluenceTestSuccess.page_title || 'Confluence 페이지'}</b>
                <small>{confluenceTestSuccess.space_key ? `${confluenceTestSuccess.space_key} / ${confluenceTestSuccess.page_id}` : confluenceTestSuccess.page_id}</small>
              </div>
            </div>
            <div className="draft-modal-actions single">
              <button className="primary-btn" type="button" onClick={closeConfluenceSuccessModal}>닫기</button>
            </div>
          </section>
        </div>
      )}

      <div className={`modal-backdrop ${modalOpen ? 'open' : ''}`} onClick={() => setModalOpen(false)} />
      <aside className={`mapping-modal ${modalOpen ? 'open' : ''}`}>
        <div className="mapping-head">
          <div>
            <span>{modalMode === 'mapping' ? 'Speaker Mapping' : modalMode === 'report_instruction' ? 'Report Instruction' : 'Report Review'}</span>
            <h3>{modalMode === 'mapping' ? '화자 매핑 확인' : modalMode === 'report_instruction' ? '회의록 작성' : '회의록 확인'}</h3>
          </div>
          <button className="icon-btn" onClick={() => setModalOpen(false)}><X size={18} /></button>
        </div>

        {modalMode === 'mapping' && (
          <div className="mapping-body split">
            <section className="mapping-column">
              <p className="modal-help">자동 매칭 결과를 확인하고 필요한 경우 실제 참석자 이름을 수정하세요.</p>
              <div className="mapping-list">
                {speakerIds.map((speakerId) => {
                  const match = matchBySpeaker(speakerMatches, speakerId);
                  return (
                    <label className="mapping-row mapping-card" key={speakerId}>
                      <div className="mapping-card-head">
                        <span className="speaker-badge">Speaker {speakerId}</span>
                        <span className="confidence-badge">신뢰도 {match?.confidence ?? '-'}</span>
                      </div>
                      <div className="mapping-field">
                        <input
                          type="text"
                          value={speakerMapping[String(speakerId)] || ''}
                          onChange={(event) => updateSpeakerName(speakerId, event.target.value)}
                          placeholder={`Speaker ${speakerId}`}
                        />
                        <div className="mapping-reason">
                          <b>매칭 근거</b>
                          <p>{match?.evidence || '자동 매칭 근거가 없습니다.'}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="sample-column">
              <div className="audio-panel">
                <b>오디오 재생</b>
                {analysisAudioUrl ? (
                  <audio ref={audioRef} src={analysisAudioUrl} controls preload="metadata" />
                ) : (
                  <div className="audio-empty">첨부된 오디오가 없습니다.</div>
                )}
              </div>
              <div className="sample-box">
                <div className="sample-box-head">
                  <b>발화 목록</b>
                  <label className="speaker-filter">
                    <span>Speaker</span>
                    <select value={selectedSpeakerFilter} onChange={(event) => setSelectedSpeakerFilter(event.target.value)}>
                      <option value="all">모두</option>
                      {speakerIds.map((speakerId) => (
                        <option value={String(speakerId)} key={`speaker-filter-${speakerId}`}>Speaker {speakerId}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="sample-list">
                  {filteredSentences.map((sentence) => (
                    <div className="sample-line" key={sentence.index}>
                      <div className="sample-speaker-cell">
                        <span>Speaker {normalizeSpeakerId(sentence.speaker_id ?? sentence.speaker)}</span>
                        <small className="time-pill">{sentence.time}</small>
                      </div>
                      <strong>{sentence.content}</strong>
                      <div className="sample-actions">
                        <button type="button" className="sample-action play" onClick={() => playSentence(sentence)}><Play size={12} />재생</button>
                        <button type="button" className="sample-action" onClick={() => openSentenceEditor(sentence)}><Pencil size={12} />편집</button>
                        <button type="button" className="sample-action danger" onClick={() => removeSentence(sentence.index)}><Trash2 size={12} />제거</button>
                      </div>
                    </div>
                  ))}
                  {filteredSentences.length === 0 && (
                    <div className="sample-empty">선택한 Speaker의 발화가 없습니다.</div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {modalMode === 'report_instruction' && (
          <div className="mapping-body report-body">
            <section className="report-instruction-panel">
              <div>
                <h4>리포트 작성 지시사항</h4>
                <p>선택 입력입니다. 특정 인물, 질의응답, 의사결정 사항 등 회의록 작성 관점을 지정할 수 있습니다.</p>
              </div>
              <textarea
                value={reportInstruction}
                onChange={(event) => setReportInstruction(event.target.value)}
                placeholder="예) 대표님의 발언은 단순 요약이 아닌 상세 정리를 원칙으로 한다. 발언의 맥락, 핵심 판단 근거, 지시사항을 빠짐없이 포함하며, 다른 참석자 발언 대비 우선순위를 두어 서술한다."
                rows={8}
                disabled={isGeneratingReport}
              />
              {isGeneratingReport && (
                <div className="report-generating">
                  <span className="loading-spinner" aria-hidden="true"></span>
                  <div>
                    <b>회의록 생성 중입니다.</b>
                    <p>화자 매핑 결과를 바탕으로 마크다운 회의록을 작성하고 있습니다.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {modalMode === 'report_review' && (
          <div className="mapping-body report-body">
            <section className="report-review-panel">
              <div>
                <h4>마크다운 회의록</h4>
                <p>내용을 확인하고 필요한 부분을 직접 편집한 뒤 확정하세요.</p>
              </div>
              <textarea
                className="report-markdown-editor"
                value={reportMarkdown}
                onChange={(event) => setReportMarkdown(event.target.value)}
                rows={24}
              />
            </section>
          </div>
        )}
        {error && <div className="modal-error-box">{error}</div>}
        {editingSentence && (
          <div className="sentence-edit-backdrop">
            <div className="sentence-edit-dialog">
              <div className="sentence-edit-head">
                <div>
                  <span>Sentence Edit</span>
                  <b>발화 내용 편집</b>
                </div>
                <button className="icon-btn" type="button" onClick={() => setEditingSentence(null)}><X size={17} /></button>
              </div>
              <div className="sentence-edit-meta">{editingSentence.time}</div>
              <label className="sentence-edit-field">
                <span>Speaker Index</span>
                <input
                  type="text"
                  value={editingSpeaker}
                  onChange={(event) => setEditingSpeaker(event.target.value)}
                  placeholder="예) 0"
                />
              </label>
              <label className="sentence-edit-field">
                <span>발화 내용</span>
                <textarea
                  value={editingContent}
                  onChange={(event) => setEditingContent(event.target.value)}
                  rows={6}
                />
              </label>
              <div className="sentence-edit-actions">
                <button className="ghost-btn" type="button" onClick={() => setEditingSentence(null)}>취소</button>
                <button className="primary-btn" type="button" onClick={saveSentenceEdit}>저장</button>
              </div>
            </div>
          </div>
        )}
        <div className="mapping-actions">
          {modalMode === 'mapping' && (
            <button className="primary-btn" onClick={saveSpeakerMapping} disabled={isSavingMap}><CheckCircle2 size={16} />매핑 저장</button>
          )}
          {modalMode === 'report_instruction' && (
            <button className="primary-btn" onClick={generateMeetingReport} disabled={isGeneratingReport}>
              {isGeneratingReport ? <span className="btn-spinner" aria-hidden="true"></span> : <FileText size={16} />}
              {isGeneratingReport ? '생성 중' : '회의록 생성'}
            </button>
          )}
          {modalMode === 'report_review' && (
            <button className="primary-btn" onClick={finalizeMeetingReport} disabled={isFinalizingReport || !reportMarkdown.trim()}><CheckCircle2 size={16} />확정</button>
          )}
        </div>
      </aside>
    </div>
    {draftSaveOpen && (
      <div className="draft-modal-backdrop open" onClick={() => setDraftSaveOpen(false)}>
        <form className="draft-modal" onSubmit={saveRecordingDraft} onClick={(event) => event.stopPropagation()}>
          <div className="draft-modal-head">
            <div>
              <span>Recording Archive</span>
              <h3>녹음 보관</h3>
            </div>
            <button className="icon-btn" type="button" onClick={() => setDraftSaveOpen(false)}><X size={18} /></button>
          </div>
          <div className="draft-warning-box">보관된 녹음은 7일 간 유지됩니다.</div>
          <label className="login-field">
            <span>제목</span>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="녹음 보관 제목" />
          </label>
          {recordingDraftError && <div className="login-error">{recordingDraftError}</div>}
          <div className="draft-modal-actions">
            <button className="line-btn" type="button" onClick={() => setDraftSaveOpen(false)}>취소</button>
            <button className="primary-btn" type="submit" disabled={isSavingDraft || !draftTitle.trim()}>
              {isSavingDraft && <span className="btn-spinner" aria-hidden="true"></span>}
              {isSavingDraft ? '저장 중' : '저장'}
            </button>
          </div>
        </form>
      </div>
    )}

    {draftPickerOpen && (
      <div className="draft-modal-backdrop open" onClick={() => setDraftPickerOpen(false)}>
        <section className="draft-modal wide" onClick={(event) => event.stopPropagation()}>
          <div className="draft-modal-head">
            <div>
              <span>Recording Archives</span>
              <h3>보관 녹음 불러오기</h3>
              <p>보관된 녹음 파일을 회의록 작성에 연결합니다.</p>
            </div>
            <button className="icon-btn" type="button" onClick={() => setDraftPickerOpen(false)}><X size={18} /></button>
          </div>
          {recordingDraftError && <div className="login-error">{recordingDraftError}</div>}
          <div className="draft-list">
            {isLoadingDrafts && <div className="account-empty">보관 녹음 목록을 불러오는 중입니다.</div>}
            {!isLoadingDrafts && recordingDrafts.map((draft) => (
              <article className={draft.available ? 'draft-list-item' : 'draft-list-item disabled'} key={draft.draft_uuid}>
                <div className="draft-list-main">
                  <div>
                    <b>{draft.title}</b>
                    <small>{formatDurationLabel(draft.duration_seconds)} · {String(draft.created_at || '').slice(0, 16).replace('T', ' ')}</small>
                  </div>
                </div>
                {draft.available ? (
                  <audio className="draft-preview-audio" src={authenticatedUrl(`/api/recording-drafts/${draft.draft_uuid}/audio`)} controls preload="metadata" />
                ) : (
                  <div className="draft-preview-missing">파일을 찾을 수 없습니다.</div>
                )}
                <button className="draft-load-btn" type="button" onClick={() => useRecordingDraft(draft)} disabled={!draft.available}>이 녹음 불러오기</button>
              </article>
            ))}
            {!isLoadingDrafts && recordingDrafts.length === 0 && <div className="account-empty">보관된 녹음이 없습니다.</div>}
          </div>
        </section>
      </div>
    )}

    {passwordSetupModal}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

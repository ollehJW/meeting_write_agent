import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BarChart3, Building2, CalendarDays, CheckCircle2, Clock3, Download, FileText, GripVertical, Home, Info, KeyRound, Tags, LogIn, LogOut, Mic2, Pencil, Play, Plus, Settings, ShieldCheck, Trash2, Trophy, UploadCloud, UserRound, UserPlus, X } from 'lucide-react';
import './styles.css';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:9701`;

function speakerIdsFromResult(result) {
  const ids = new Set((result?.sentences || []).map((sentence) => sentence.speaker));
  return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}

function matchBySpeaker(matchesData, speakerId) {
  return (matchesData?.matches || []).find((match) => Number(match.speaker_id) === Number(speakerId));
}

async function apiError(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  return new Error(data.detail || fallbackMessage);
}

function MarkdownReport({ markdown }) {
  return (
    <article className="markdown-report">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || ''}</ReactMarkdown>
    </article>
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
  const [referenceFiles, setReferenceFiles] = useState([]);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingStartTime, setMeetingStartTime] = useState('');
  const [meetingEndTime, setMeetingEndTime] = useState('');
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
  const [isDownloadingReferences, setIsDownloadingReferences] = useState(false);
  const [reportCompleted, setReportCompleted] = useState(false);
  const [editingSentence, setEditingSentence] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingSpeaker, setEditingSpeaker] = useState('');
  const [selectedSpeakerFilter, setSelectedSpeakerFilter] = useState('all');
  const pollRef = useRef(null);
  const processRef = useRef(null);
  const logBodyRef = useRef(null);
  const audioRef = useRef(null);
  const loungeAudioRef = useRef(null);

  const speakerIds = useMemo(() => speakerIdsFromResult(result), [result]);
  const filteredSentences = useMemo(() => {
    const sentences = result?.sentences || [];
    if (selectedSpeakerFilter === 'all') return sentences;
    return sentences.filter((sentence) => String(sentence.speaker) === selectedSpeakerFilter);
  }, [result, selectedSpeakerFilter]);
  const audioUrl = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : ''), [audioFile]);
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
  const canStart = audioFile && meetingTitle.trim() && selectedCategoryUuid && meetingPurpose.trim() && meetingDate && meetingStartTime && meetingEndTime && meetingOrganizations.length > 0 && participants.length > 0 && (!job || job.status === 'failed' || job.status === 'completed');

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

  function defaultMeetingOrganizations(user = authUser) {
    return user?.display_name ? [user.display_name] : [];
  }

  function resetMeetingForm(user = authUser) {
    setAudioFile(null);
    setReferenceFiles([]);
    setMeetingTitle('');
    setSelectedCategoryUuid('');
    setMeetingPurpose('');
    setMeetingDate('');
    setMeetingStartTime('');
    setMeetingEndTime('');
    setMeetingOrganizations(defaultMeetingOrganizations(user));
    setOrganizationInput('');
    setParticipants([]);
    setParticipantInput('');
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (loungeAudioUrl) URL.revokeObjectURL(loungeAudioUrl);
    };
  }, [loungeAudioUrl]);

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
    if (currentView === 'home' || currentView === 'lounge') {
      loadLoungeReports();
    }
  }, [currentView, authToken]);

  useEffect(() => {
    if (!authToken) return;
    if (currentView === 'home' || currentView === 'create' || currentView === 'settings') {
      loadMembers();
    }
    if (currentView === 'create' || currentView === 'settings') {
      loadCategories();
    }
  }, [currentView, authToken]);

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
    if (loungeAudioUrl) {
      URL.revokeObjectURL(loungeAudioUrl);
      setLoungeAudioUrl('');
    }

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
        setIsLoadingLoungeAudio(true);
        const audioResponse = await fetch(API_BASE + '/api/reports/' + report.job_id + '/audio', { headers: authHeaders() });
        if (audioResponse.status === 401) {
          handleExpiredSession();
          return;
        }
        if (audioResponse.ok) {
          const audioBlob = await audioResponse.blob();
          setLoungeAudioUrl(URL.createObjectURL(audioBlob));
        }
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
    if (loungeAudioUrl) {
      URL.revokeObjectURL(loungeAudioUrl);
      setLoungeAudioUrl('');
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

  function handleListKeyDown(event, addItem) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addItem();
  }

  function timeToSelectParts(value) {
    if (!value) return { period: 'AM', hour: '', minute: '00' };
    const [hourText, minute = '00'] = value.split(':');
    const hour24 = Number(hourText);
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return { period, hour: String(hour12), minute };
  }

  function setHalfHourTime(currentValue, setValue, key, nextValue) {
    const parts = { ...timeToSelectParts(currentValue), [key]: nextValue };
    if (!parts.hour) {
      setValue('');
      return;
    }

    let hour = Number(parts.hour);
    if (parts.period === 'AM') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    setValue(`${String(hour).padStart(2, '0')}:${parts.minute}`);
  }

  function parseStartSeconds(timeRange) {
    const match = String(timeRange || '').match(/([0-9]+(?:\.[0-9]+)?)s/);
    return match ? Number(match[1]) : 0;
  }

  function playSentence(sentence) {
    if (!audioRef.current || !audioUrl) return;
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

  async function uploadAndRun() {
    if (!audioFile) return;
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
    formData.append('audio', audioFile);
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
      setCurrentView('report');
      setModalOpen(false);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCompletingReport(false);
    }
  }



  if (!authUser || !authToken) {
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
          <button className={`side-item ${currentView === 'create' || currentView === 'report' ? 'active' : ''}`} onClick={() => setCurrentView(reportCompleted ? 'report' : 'create')}><Mic2 size={17} /><span className="side-name">회의록 생성</span></button>
          <button className={`side-item ${currentView === 'lounge' ? 'active' : ''}`} onClick={() => setCurrentView('lounge')}><FileText size={17} /><span className="side-name">회의록 라운지</span></button>
          <button className={`side-item ${currentView === 'settings' ? 'active' : ''}`} onClick={() => { setSettingsTab('members'); setCurrentView('settings'); }}><Settings size={17} /><span className="side-name">설정</span></button>
          <div className={`side-subnav ${currentView === 'settings' ? 'open' : ''}`}>
            <button className={`side-subitem ${currentView === 'settings' && settingsTab === 'members' ? 'active' : ''}`} onClick={() => { setSettingsTab('members'); setCurrentView('settings'); }}>멤버 관리</button>
            <button className={`side-subitem ${currentView === 'settings' && settingsTab === 'categories' ? 'active' : ''}`} onClick={() => { setSettingsTab('categories'); setCurrentView('settings'); }}>카테고리 관리</button>
          </div>
          {authUser.role === 'admin' && (
            <button className={`side-item ${currentView === 'accounts' ? 'active' : ''}`} onClick={() => setCurrentView('accounts')}><ShieldCheck size={17} /><span className="side-name">계정 권한</span></button>
          )}
        </nav>
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
                          value={timeToSelectParts(meetingStartTime).period}
                          onChange={(event) => setHalfHourTime(meetingStartTime, setMeetingStartTime, 'period', event.target.value)}
                        >
                          <option value="AM">오전</option>
                          <option value="PM">오후</option>
                        </select>
                        <select
                          value={timeToSelectParts(meetingStartTime).hour}
                          onChange={(event) => setHalfHourTime(meetingStartTime, setMeetingStartTime, 'hour', event.target.value)}
                        >
                          <option value="" disabled>시</option>
                          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
                            <option value={hour} key={`start-hour-${hour}`}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={timeToSelectParts(meetingStartTime).minute}
                          onChange={(event) => setHalfHourTime(meetingStartTime, setMeetingStartTime, 'minute', event.target.value)}
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
                          value={timeToSelectParts(meetingEndTime).period}
                          onChange={(event) => setHalfHourTime(meetingEndTime, setMeetingEndTime, 'period', event.target.value)}
                        >
                          <option value="AM">오전</option>
                          <option value="PM">오후</option>
                        </select>
                        <select
                          value={timeToSelectParts(meetingEndTime).hour}
                          onChange={(event) => setHalfHourTime(meetingEndTime, setMeetingEndTime, 'hour', event.target.value)}
                        >
                          <option value="" disabled>시</option>
                          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
                            <option value={hour} key={`end-hour-${hour}`}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={timeToSelectParts(meetingEndTime).minute}
                          onChange={(event) => setHalfHourTime(meetingEndTime, setMeetingEndTime, 'minute', event.target.value)}
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
                        <div className="field-label">우리 팀 간편 추가</div>
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
                      <label className="field-label">회의 녹음 파일 <span className="required">필수</span></label>
                      <label className="upload-box">
                        <input
                          type="file"
                          accept="audio/*,.m4a,.mp3,.wav,.aac,.flac"
                          onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
                        />
                        <UploadCloud className="upload-icon" size={34} />
                        <b>{audioFile ? audioFile.name : '녹음 파일을 선택하거나 끌어오세요'}</b>
                        <span>m4a, wav, mp3 등 오디오 파일을 업로드할 수 있습니다.</span>
                      </label>
                    </div>

                    <div className="upload-col">
                      <label className="field-label">회의 참고자료 <span className="optional">선택</span></label>
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
                      <div className={`pipeline-step ${job?.progress >= 90 ? 'active' : ''}`}><span>4</span><b>Correction</b><small>STT 결과 교정</small></div>
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
                        <button className="lounge-report-row" type="button" key={report.report_uuid} onClick={() => openLoungeReport(report)}>
                          <div>
                            <b>{report.title}</b>
                            <span>{report.category_name || '카테고리 미지정'} · 참가 {(report.participants || []).length}명 · {report.start_time || '--:--'} - {report.end_time || '--:--'}</span>
                          </div>
                        </button>
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
                  <h2>{settingsTab === "members" ? "멤버 관리" : "카테고리 관리"}</h2>
                  <p>{settingsTab === "members" ? "회의 참석자 빠른 추가에 사용할 우리 팀 인원을 관리합니다." : "회의록을 분류할 카테고리를 관리합니다."}</p>
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
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} controls preload="metadata" />
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
                        <span>Speaker {sentence.speaker}</span>
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
    {passwordSetupModal}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);

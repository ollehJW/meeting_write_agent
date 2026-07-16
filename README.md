# WIAMeet Web Service

회의 녹음 파일을 업로드하면 `run1.py` 기반 파이프라인으로 화자 분리, 전처리, STT, STT 결과 교정, 화자 매칭을 수행하고, 처리 완료 후 웹 화면에서 화자 매핑을 확인/수정할 수 있습니다.

## 구성

- `backend/`: FastAPI 서버
- `backend/processor.py`: `run1.py` 기반 화자 분리, 전처리, Qwen3-ASR STT, LLM 기반 STT 교정/화자 매칭 처리 로직
- `frontend/`: React + Vite 웹 UI
- `jobs/`: 업로드 파일과 처리 결과 저장 위치

## 사전 준비

Python 의존성 설치:

```bash
pip install -r requirements.txt
```

Frontend 의존성 설치:

```bash
cd frontend
npm install
```

LLM 호출 설정은 루트의 `.env`에서 관리합니다. `.env.example`을 참고해 값을 채우세요.

```bash
OPENAI_MODEL=gpt-5.4
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3
OPENAI_API_VERSION=2025-04-01-preview
```

LLM 프롬프트는 `backend/prompts/` 아래의 txt 파일에서 관리합니다.

- `stt_correction.txt`: STT 결과 교정
- `speaker_matching.txt`: 화자 매칭
- `report_generation.txt`: 회의록 작성

다음 모델/폴더가 루트 경로에 있어야 합니다.

- `qwen3-asr-1.7b/`
- `pyannote_diarization_local/`

## 실행 방법

터미널 1: backend 실행

```bash
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 9701 --reload
```

터미널 2: frontend 실행

```bash
cd frontend
npm run dev
```

브라우저에서 접속:

```text
http://localhost:9702/
```

## 사용 흐름

1. 웹 화면에서 회의명, 회의 목적, 회의 일자, 시작/종료 시간, 참석 조직, 참석자, 회의 녹음 파일을 필수로 입력합니다.
2. `회의록 분석`을 누르면 backend가 작업을 생성합니다.
3. backend는 업로드 파일을 `jobs/<job_id>/` 아래에 저장합니다.
4. 화자 분리, 전처리, STT가 순서대로 실행됩니다.
5. STT 결과 교정과 화자 자동 매칭이 이어서 실행됩니다.
6. 처리 완료 후 화자 매칭 팝업이 자동으로 열립니다.
7. 자동 매칭 결과, confidence, 매칭 이유를 확인하고 필요한 경우 이름을 수정합니다.
8. `매핑 저장`을 누르면 `refined_result.json`과 `speaker_matches.json`이 갱신됩니다.

## 생성 파일

각 작업별 결과는 `jobs/<job_id>/` 아래에 저장됩니다.

- `meeting_metadata.json`: 회의명, 회의 목적 입력에 함께 쓰는 회의 일자, 시작/종료 시간, 참석 조직/참석자
- `result.json`: STT와 숫자 speaker ID가 포함된 원본 처리 결과
- `stt_corrections.json`: LLM이 찾은 STT 교정 항목과 적용 결과
- `refined_result.json`: STT 교정과 화자명이 반영된 결과
- `speaker_matches.json`: speaker ID와 화자명 매핑 결과, confidence, 근거

## API 요약

- `POST /api/jobs`: 녹음 파일 업로드 및 처리 시작
- `GET /api/jobs/{job_id}`: 작업 상태 조회
- `GET /api/jobs/{job_id}/result`: 처리 결과, STT 교정, 화자 매칭 결과 조회
- `GET /api/jobs/{job_id}/stt-corrections`: STT 교정 결과 조회
- `GET /api/jobs/{job_id}/speaker-matches`: 화자 매칭 결과 조회
- `GET /api/jobs/{job_id}/refined-result`: 최종 refined transcript 조회
- `POST /api/jobs/{job_id}/speaker-map`: 화자 매핑 저장
- `GET /api/jobs/{job_id}/download/{filename}`: 결과 파일 다운로드

## 참고

- backend는 장시간 STT 작업을 처리하므로 현재 작업 큐는 `max_workers=1`로 제한되어 있습니다.
- `--reload` 옵션을 사용하므로 backend 코드 수정 시 서버가 자동 재시작됩니다.
- pyannote에서 `torchcodec` 관련 경고가 표시될 수 있지만, 현재 구현은 `torchaudio.load()`로 waveform을 미리 로드해 전달합니다.

  - 아이디: admin
  - 비밀번호: wia1234!

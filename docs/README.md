# 시후의 하루 계획표 — 온라인 공유판

이 폴더(`docs/`)는 GitHub Pages로 배포되는 **가족이 함께 보는 웹 버전**입니다.
시후가 입력하면 부모님 기기에서 같은 기록을 실시간으로 볼 수 있습니다.

같은 프로젝트의 [`study_plan/`](../) 안에 있는 로컬 데스크톱 버전(`app.py`)과는
별개입니다 — 그건 한 대의 PC 안에서만 도는 개인용이고, 이 폴더는 여러 기기가
인터넷으로 같은 데이터를 보는 공유용입니다.

## 작동 방식

- 데이터는 **Firebase(Firestore)**라는 구글의 무료 클라우드 데이터베이스에 저장됩니다.
- "가족 코드"라는 무작위로 만든 긴 문자열 하나가 가족 하나를 구분합니다.
  이 코드가 담긴 **링크를 아는 사람만** 데이터를 보고 쓸 수 있습니다.
  (구글 문서를 "링크 아는 사람에게 공유"하는 것과 같은 방식입니다.)
- 로그인 화면은 없습니다. 처음 열면 자동으로 가족 코드가 만들어지고,
  그 링크를 상대방에게 보내면 같은 화면을 보게 됩니다.

## 처음 설정하기 (한 번만)

배포하려는 사람이 아래 두 가지를 준비해야 합니다.

### 1. Firebase 프로젝트 만들기 (5분, 무료)

1. https://console.firebase.google.com 접속 → 구글 계정으로 로그인
2. **프로젝트 추가** → 이름 입력(예: `sihu-study-plan`) → 애널리틱스는 꺼도 됩니다 → 만들기
3. 왼쪽 메뉴 **빌드 → Firestore Database** → **데이터베이스 만들기**
   → 위치는 `asia-northeast3(서울)` 선택 → **테스트 모드**로 시작해도 되지만,
   만든 뒤 **규칙(Rules)** 탭에서 이 저장소의 [`firestore.rules`](firestore.rules)
   내용을 그대로 붙여넣고 **게시**하세요.
4. 왼쪽 메뉴 **빌드 → Authentication** → **시작하기** →
   **Sign-in method** 탭 → **익명(Anonymous)** 사용 설정
5. 프로젝트 개요 옆 **⚙ (프로젝트 설정)** → 아래로 스크롤 → **내 앱** →
   웹 아이콘(`</>`) 클릭 → 앱 닉네임 아무거나 입력 → 앱 등록
   → 화면에 나오는 `firebaseConfig = { ... }` 값을 복사

6. 복사한 값을 이 폴더의 [`firebase-config.js`](firebase-config.js) 파일에
   붙여넣어 저장하세요.

### 2. GitHub에 올리고 Pages 켜기

```bash
cd study_plan
git init
git add .
git commit -m "시후의 하루 계획표"
git branch -M main
git remote add origin https://github.com/<계정명>/<저장소명>.git
git push -u origin main
```

그다음 GitHub 저장소 페이지에서:

**Settings → Pages** → Source를 **Deploy from a branch**로,
Branch를 **main** / **/docs** 로 선택 → **Save**

몇 분 뒤 `https://<계정명>.github.io/<저장소명>/` 주소로 접속됩니다.
이 주소를 처음 여는 사람이 "우리 가족"이 됩니다 — 열어서 나오는 온보딩 화면의
링크를 나머지 한 명에게 보내주면 됩니다.

## 보안에 대해

- `firebase-config.js`의 `apiKey`는 비밀번호가 아니라 원래 공개되는 값입니다
  (Firebase 웹앱의 표준 방식). 저장소가 공개(public)여도 문제없습니다.
- 실제 접근 통제는 **무작위로 만들어진 긴 가족 코드**와, 위에서 설정한
  **Firestore 보안 규칙**(로그인한 사람만 접근 가능)이 담당합니다.
- 이 코드(공유 링크)를 가족 외의 사람과 공유하지 않으면 됩니다.
- 더 강한 보안(가족별 진짜 로그인/비밀번호)이 필요하면 별도로 요청하세요 —
  지금 구조보다 설정이 꽤 복잡해집니다(유료 플랜 필요).

## 로컬에서 미리 보기

```bash
cd study_plan/docs
python3 -m http.server 8000
```
브라우저에서 `http://127.0.0.1:8000` 접속. (`firebase-config.js`를 먼저
채워야 정상 동작합니다 — 비어 있으면 "연결할 수 없습니다" 화면이 뜹니다.)

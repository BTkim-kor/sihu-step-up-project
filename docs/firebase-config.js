// Firebase 콘솔 > 프로젝트 설정(⚙) > 내 앱 > SDK 설정 및 구성 에서
// 나오는 값을 그대로 복사해 아래에 붙여넣으세요.
//
// apiKey 등은 "비밀번호"가 아니라 클라이언트에 공개되는 값입니다.
// (Firebase 웹앱의 표준 방식입니다.) 실제 접근 통제는 이 값이 아니라
// Firestore 보안 규칙(firestore.rules)과, 아무나 추측할 수 없는
// 가족 공유 링크가 담당합니다.
//
// 설정 방법은 저장소의 docs/README.md 를 참고하세요.

const firebaseConfig = {
  apiKey: "여기에-API-키를-붙여넣으세요",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx",
};

// 화면을 그리기 전에 저장된 테마(라이트/다크)를 적용한다 (깜빡임 방지). 없으면 기기 설정을 따른다.
try {
  const t = localStorage.getItem('compose:theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* 저장소 사용 불가: 기기 설정을 따름 */ }

# AGENTS.md

> 다음 개발자(또는 AI 에이전트)가 이 프로젝트에 들어왔을 때 빠르게 방향을
> 잡고, 잘못된 길로 새지 않도록 정리한 문서입니다. 코드보다 **방향성**과
> **의사결정 기준**에 무게를 둡니다.

---

## 1. 한 줄 요약

웹 어디서든 **텍스트를 선택만 하면** 그 상황에 어울리는 작은 도구가 떠오르는
Chrome 확장. 인스피레이션은 구글 번역의 선택 팝오버 + 슬랙의 호버 액션 바.

## 2. 우리는 누구를 위해 만드는가

**일반인 사용자**가 1차 타겟입니다. 개발자도 쓰겠지만, "내가 우리 회사
이메일·매크로·로그·정규식을 다룬다"는 가정은 하지 않습니다.

이건 의도적인 선택이에요. 이유:

- 개발자 전용 텍스트 툴은 이미 시장에 많고 차별화가 어려움
- 일반인은 "이 이상한 문자열 뭐지?"(QR로 보면 어떻게 생겼지, 이 주소는
  어디지, 이 메일 주소로 한 번 보내볼까) 같은 작은 마찰을 매일 겪지만
  도구가 흩어져 있음
- 텍스트 선택 → 우리 툴바 → 즉시 결과, 이 짧은 루프가 일반인에게도 통함

기준점:

- **친구 어머니가 써도 이해할 수 있는가?** → ✅ 만든다
- **백엔드 개발자만 쓰는가?** → ❌ 만들지 않거나, 보조 카테고리로 둠

## 3. 우선순위 (2026-05 기준)

### v0.x 다음에 만들 것 (확정)

**[G] 패턴 인식** — 선택한 텍스트가 무엇인지를 알아채고 자연스러운 액션을
제공하는 카테고리. 일반인에게 가장 유용.

- URL 선택 → "QR 코드로 보기", "URL 짧게/풀어보기", "쿼리 깔끔하게 보기"
- 이메일 선택 → "메일 쓰기 (mailto:)"
- 전화번호 선택 → "전화 걸기 (tel:)" (모바일·태블릿에서 유용)
- 좌표(위경도) 선택 → "Google Maps에서 열기", "네이버지도/카카오맵에서 열기"
- 색상 코드(`#FF6B35`, `rgb(...)`) 선택 → 색 미리보기 + HEX↔RGB↔HSL 변환

**케이스 변환 + Slug**
- camelCase / snake_case / kebab-case / SCREAMING_SNAKE / Title Case 전환
- Slug 만들기 (`"Hello World, 안녕"` → `"hello-world"`) — 블로거·자영업자가
  URL 만들 때 유용

### v0.x 다음 다음 (가능성)

- 한↔영 자판 복원 (`"ㅎㄴ ㅔㅣㅣㅐ"` → `"hello world"`)
- 외부 서비스로 보내기 (Google 번역, Naver/Daum 사전, Wikipedia)
- 타임스탬프 → 사람 시간 (단, 일반인 친화 표현 위주: "어제 09:00")

### 의도적으로 만들지 않는 것

다음은 **이 프로젝트에서 다루지 않습니다**. 비슷한 요구가 와도 거절하거나
명확한 일반인 사용 시나리오가 함께 와야 검토.

- JWT 디코더 (이미 개발자 도구가 많고 일반인은 안 씀)
- 정규식 빌더/테스터
- HEX ↔ Decimal, SHA-256 등 순수 해시
- minify/uglify
- ANSI escape 처리
- 사내 로그 포맷 파싱
- 사용자가 자체 스크립트를 등록하는 플러그인 시스템 (보안 검토 필수, 범위 밖)

`base64 인코드/디코드`는 v0.1에서 만들었고 유지합니다 — 일반인이
"의심스러운 문자열"을 만났을 때 "이게 뭐야?"를 즉시 풀어주는 발견의
순간을 제공하기 때문. 다만 새 *개발자* 도구는 추가 안 합니다.

---

## 4. 아키텍처 (최소 지식)

```
src/
  background/index.ts   # 서비스 워커 — 우클릭 컨텍스트 메뉴 등록 + 라우팅
  content/
    index.ts            # 선택 감지, 툴바/팝오버 오케스트레이션
    toolbar.ts          # 슬랙 스타일 호버 툴바 (선택 위에 떠오름)
    popover.ts          # 결과 패널 (페이지에 앵커, 스크롤 따라감)
    root.ts             # Shadow DOM 호스트 + isInsideOurUI 헬퍼
    styles.ts           # 인라인 CSS (단일 ESM 번들 유지 위해 문자열로)
  tools/
    registry.ts         # 등록된 툴 목록
    <tool-name>/
      index.ts          # Tool 객체 export
      <logic>.ts        # 순수 로직 (테스트 가능)
  types.ts              # Tool / ToolResult / ToolAction 인터페이스
manifest.config.ts      # @crxjs MV3 manifest (런타임에 vite가 컴파일)
```

### 데이터 흐름

```
       1. mouseup
사용자 ───────────► content/index.ts ── 등록된 모든 툴 가져옴
   │                       │
   │                       │ canHandle(text) → 적합 여부 결정
   │                       │
   │                       ▼
   │                  toolbar.showToolbar(entries)
   │                       │  ─ 적합한 툴: 정상색
   │                       │  ─ 부적합 툴: dim (0.38), 클릭은 여전히 가능
   │                       ▼
   │                  [📋 base64↓] [📋→ base64↑]  ← 모든 등록된 툴 다 보임
   │                       │
   │     아이콘 클릭        │
   └───────────────────────►runTool(tool, text, anchor)
                            │
                            ▼
                       popover.showPopover({ tool, result, anchor })
                            │
                       ┌────┴────┐
                       │  결과   │
                       │ [복사] [열기] (URL이면)
                       └─────────┘
```

우클릭 흐름은:

```
사용자 우클릭 → Chrome → background/index.ts (등록한 메뉴 항목 onClicked)
                                     │
                                     │  chrome.tabs.sendMessage
                                     │  (info.frameId 지정 — iframe 안의 선택도 OK)
                                     ▼
                              content/index.ts onMessage
                                     │
                                     ▼
                              runTool(...) → popover
```

### 핵심 디자인 결정

- **모든 툴은 항상 보인다.** `canHandle`은 *힌트*일 뿐 *필터*가 아님.
  `base64 인코드`처럼 평문에 동작하는 툴이 base64 선택할 때 사라지면 안 되고,
  반대로 `base64 디코드`도 평문 선택할 때 사라지면 안 됨. **부적합한 툴은
  dim 처리, 클릭은 가능**.
- **팝오버는 페이지에 앵커.** `position: absolute` + `pageY = rect.top +
  window.scrollY`. 스크롤하면 같이 움직임. 화면 밖으로 사라지는 건 OK
  (스펙).
- **팝오버는 외부 클릭으로 닫히지 않음.** ESC 또는 새 선택만 닫음. 이건
  의도된 동작.
- **Shadow DOM 격리.** 호스트 페이지의 CSS가 우리 UI를 망치거나 그 반대를
  못 하도록.
- **iframe도 주입.** `all_frames: true`. 커뮤니티 사이트의 본문이 iframe인
  경우(kone.gg, Notion 임베드 등)에 우리 UI가 사라지지 않도록.

---

## 5. 새 툴 추가하기 (10분 안)

### 5.1. 폴더 + 파일 만들기

```
src/tools/my-tool/
├── index.ts     # Tool 객체 export
└── logic.ts     # 순수 함수 (테스트 가능)
```

### 5.2. `logic.ts` (순수 로직만)

```ts
// 이 함수는 DOM, chrome.*, window.*에 의존하지 않아야 함 → 단위 테스트 가능
export function transform(input: string): string {
  return input.toUpperCase();
}

export function looksLikeMyThing(input: string): boolean {
  // canHandle()의 진리값을 결정. 휴리스틱은 보수적으로 (오탐 < 미탐).
  return /^[A-Z\s]+$/.test(input);
}
```

### 5.3. `index.ts` (Tool 정의)

```ts
import type { Tool, ToolResult } from "../../types";
import { transform, looksLikeMyThing } from "./logic";

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"
  width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- 16x16 viewBox 권장. currentColor 사용해서 hover/dim 색 따라가게. -->
</svg>`;

export const myTool: Tool = {
  id: "my-tool",                       // kebab-case, 안 바뀜
  name: "내 도구",                      // 한국어 OK, 툴팁과 컨텍스트 메뉴에 표시
  iconSvg: ICON_SVG,
  canHandle(selection) {
    return looksLikeMyThing(selection);
  },
  run(selection): ToolResult {
    try {
      return {
        title: "원본 → 변환됨",
        body: transform(selection),
        status: "ok",
      };
    } catch (err) {
      return {
        title: "내 도구 실패",
        body: err instanceof Error ? err.message : String(err),
        status: "error",
      };
    }
  },
};
```

### 5.4. 레지스트리에 등록

```ts
// src/tools/registry.ts
import { myTool } from "./my-tool";

export const tools: Tool[] = [
  base64DecoderTool,
  base64EncoderTool,
  myTool,            // ← 여기 추가
];
```

이게 전부입니다. 다음 번 빌드부터:

- 호버 툴바에 자동 노출 (canHandle이 false면 dim)
- 우클릭 컨텍스트 메뉴 `Sincerity Tools > 내 도구`에 자동 노출
- docs 페이지에도 추가하고 싶으면 `docs/index.html`의 로드맵 카드 섹션에
  같은 패턴으로 한 카드 추가

### 5.5. ToolResult의 `actions`

결과에 컨텍스트 버튼이 필요하면 (예: URL이 결과면 "열기"):

```ts
import type { ToolAction } from "../../types";

const actions: ToolAction[] = [];
if (isOpenableUrl(decoded)) {
  actions.push({
    label: "열기",
    iconSvg: OPEN_ICON_SVG,
    variant: "primary",
    onClick: () => window.open(decoded, "_blank", "noopener,noreferrer"),
  });
}
return { title, body: decoded, status: "ok", actions };
```

`actions`는 팝오버 푸터 왼쪽에 렌더되고, "복사" 버튼은 자동으로 오른쪽에
놓입니다.

---

## 6. 디자인 원칙

### 시각

- 다크 슬랙 톤. `--bg`, `--surface`, `--accent` 토큰은 `src/content/styles.ts`
  상단에 모여 있음. 새 색을 박지 말고 토큰 추가.
- 아이콘은 단색 stroke SVG. 16x16 viewBox. `currentColor` 사용해야 hover/dim
  상태가 자동으로 따라옴.

### UX

- 결과는 항상 **textContent**로 렌더 (innerHTML 아님). 선택 텍스트가 곧
  XSS 표면이 될 수 있어서. 굳이 HTML 렌더가 필요하면 `bodyHtml` 사용하되
  본인이 sanitize 책임.
- 에러도 결과의 한 형태로 다룸 (`status: "error"`). throw하지 말고 자연스러운
  결과로 돌려줘서 사용자가 무엇이 잘못됐는지 한 번에 보게.
- 자동 액션은 신중히. 우리 도구는 "도와주는" 느낌이어야 하고 "사용자 모르게
  뭔가 한" 느낌이면 안 됨. 예: 디코드된 URL을 자동으로 새 탭에 열지 말고,
  "열기" 버튼을 제공.

### 코드

- TypeScript strict. `any` 금지.
- Comment은 **why**를 적기. **what**은 코드가 이미 말함. 이 프로젝트의
  기존 주석들이 좋은 예시.
- 로직은 순수 함수로, side-effect는 얇은 wrapper에. 단위 테스트 시 brittle해지지 않음.

---

## 7. 릴리스

```bash
npm run release:patch   # 0.1.3 -> 0.1.4
npm run release:minor   # 0.1.3 -> 0.2.0
npm run release:major   # 0.1.3 -> 1.0.0
```

자동으로:

1. 워킹트리가 dirty면 `chore: pre-release sync` 커밋
2. package.json 버전 업
3. `npm run build`
4. `releases/sincerity-tools-vX.Y.Z.zip` 생성
5. `release: vX.Y.Z` 커밋 + `vX.Y.Z` 태그
6. `git push --follow-tags`
7. `gh release create vX.Y.Z <zip>` 호출 — GitHub Releases에 zip 첨부

플래그: `--no-tag`, `--no-zip`, `--no-commit`, `--no-push`, `--draft`,
`--notes "..."`.

## 8. GitHub Pages

`docs/index.html`이 그대로 호스팅됩니다 (Settings → Pages → main + /docs).
새 툴을 추가하면 그 페이지의 "로드맵" 섹션 카드도 갱신해 주세요. 빌드
파이프라인 없음 — 그냥 push하면 1~2분 뒤 반영.

---

## 9. 자주 겪는 함정

- **content script가 안 뜬다** → `chrome://`, `chrome-extension://`,
  `chrome.google.com/webstore` 같은 페이지에선 안 됨. 일반 사이트에서 테스트.
- **iframe 안의 선택에서 안 뜬다** → `all_frames: true` 켜져 있는지 확인.
- **dist 잠금 에러 (Windows + WSL/샌드박스)** → Windows 탐색기에서
  `.dist-stale`, `.git-broken*` 등 hidden 폴더 한 번 청소.
- **vite 빌드가 Node 버전 거부** → vite v5 + Node 20.19+ / 22.x. 우리 lock은
  vite ^5.4.0에 고정.

## 10. 외부 참고

- Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate
- `@crxjs/vite-plugin`: https://crxjs.dev/vite-plugin
- Shadow DOM positioning gotchas: 우리 `src/content/root.ts` 주석에 정리됨

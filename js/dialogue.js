/* =====================================================================
 * 던전 (DunJeon) — 대사 엔진 (컨텍스트 기반 캐릭터 대사)
 * 로드 순서 2번. core.js 의 state/party/say/pick 만 런타임에 쓰고,
 * 로드 시점에는 아무것도 평가하지 않으므로 core.js 다음이면 어디든 안전하다.
 *
 * M3.5a 이전에는 잡담 풀이 8줄뿐이라 "맨날 같은 말만 한다"는 지적이 있었다.
 * 이제는 상황(이벤트) × 캐릭터로 갈라진 풀에서 뽑고, 캐릭터별 최근 8개를
 * 기억해 제외 추첨한다. 이벤트 대사에는 10초 쿨다운이 걸려 도배되지 않는다.
 *
 * 캐릭터 성격
 *   유리(knight) 파티 리더 — 씩씩하고 앞장선다. 반말, 짧고 힘있게.
 *   모리(mage)   마법사    — 시크하고 건조하다. 관찰·분석조, 감탄은 인색.
 *   리라(priest) 사제      — 다정하고 걱정이 많다. 존댓말, 다들 챙긴다.
 *   토토(porter) 짐꾼      — 돈밝힘 + 너스레. 계산이 빠르고 능청스럽다.
 * =================================================================== */
'use strict';

/* 이벤트 키 → 캐릭터 id(knight/mage/priest/porter) → 대사 배열.
 * 캐릭터 키가 없는 이벤트는 그 캐릭터가 말하지 않는다(예: 회복 대사는 사제만). */
const DIALOGUE = {
  /* ---------------- 전투 ---------------- */
  combat: {
    knight: ['전투다! 내 뒤로 붙어!', '왔구나. 한 마리도 놓치지 마!', '자, 몸 좀 풀어볼까!'],
    mage: ['숫자는 세어뒀어. 문제없어.', '…시끄러운 게 왔네.', '거리 유지해. 태울 준비 됐으니까.'],
    priest: ['다들 조심해요, 적이에요!', '무리하지 마세요! 제가 볼게요!', '앗, 저기 뭔가 움직여요…!'],
    porter: ['어이쿠, 손님이 오셨네!', '싸우는 건 좋은데 짐은 안 떨어뜨릴게요!', '이거 이기면 전리품 제 몫 있죠?'],
  },
  boss: {
    knight: ['커다란 게 나왔어… 물러설 순 없지!', '이게 이 갱도의 주인인가. 잘 됐어!', '전부 집중해! 여기가 고비야!'],
    mage: ['개체값이 규격 밖이야. 재밌겠네.', '…이건 좀 세다.', '마나는 아끼지 않을게.'],
    priest: ['저, 저렇게 큰 게…! 다들 뭉쳐요!', '무서워도… 제가 다 지켜드릴게요!', '부디 무사히 끝나기를…'],
    porter: ['보스님, 협상은 안 될까요…?', '큰 놈은 주머니도 큰 법이죠!', '살아만 나가면 값은 두둑할 거예요!'],
  },
  boss_golem: {
    knight: ['수정 껍질이라도 부수면 그만이야!'],
    mage: ['결정 구조가 보여. 관절이 약점이야.'],
    priest: ['빛이… 저 몸에서 반사돼요, 눈 조심해요!'],
    porter: ['저 수정 한 조각만 떼어가도 부자인데…'],
  },
  boss_hydra: {
    knight: ['머리가 셋? 그럼 세 번 베면 되지!'],
    mage: ['머리마다 따로 세. 하나씩 지워야 해.'],
    priest: ['독을 뱉어요! 물보라를 피하세요!'],
    porter: ['머리 셋이면 밥값도 세 배겠네요…'],
  },
  boss_shadow: {
    knight: ['그림자든 뭐든, 실체는 하나야!'],
    mage: ['분신이야. 진짜는 마력이 달라.'],
    priest: ['어느 쪽이 진짜인지… 눈을 믿지 마세요!'],
    porter: ['그림자는 값이 안 나가는데 말이죠…'],
  },
  boss_slimeking: {
    knight: ['왕이면 뭐해, 결국 슬라임이잖아!'],
    mage: ['점성이 높아. 태우면 굳어.'],
    priest: ['끈적한 게 튀어요! 발밑 조심하세요!'],
    porter: ['젤리 왕관은 팔리려나…?'],
  },
  boss_lich: {
    knight: ['죽은 주제에 말이 많군!'],
    mage: ['죽음의 마력… 원리는 나도 알아.'],
    priest: ['가엾어라… 편히 잠들게 해드려요.'],
    porter: ['해골한테 지갑이 있을 리 없잖아요…'],
  },
  boss_clear: {
    knight: ['해냈어! 더 깊이 가보자!', '봤지? 우리 파티, 물건이라니까!', '한숨 돌리고 — 다음!'],
    mage: ['정리 끝. 다음.', '…생각보단 싱거웠네.', '기록해둘 만한 상대였어.'],
    priest: ['다들 무사해서 다행이에요…!', '휴… 심장이 아직도 뛰어요.', '잘 싸우셨어요, 정말로요!'],
    porter: ['자, 전리품 정산 들어갑니다!', '이 맛에 광산 오죠!', '보스 하나 = 한 달 치 밥값!'],
  },
  arena_clear: {
    knight: ['전부 쓸어버렸어! 보상을 챙기자!', '마지막 웨이브까지 완벽해!', '문이 열렸어. 가자!'],
    mage: ['웨이브 종료. 예정대로야.', '…이제 좀 조용해졌네.'],
    priest: ['다들 상처는 없죠? 정말 잘했어요!', '끝났어요… 정말 끝났어요!'],
    porter: ['도전방 보상! 이게 진짜 알짜배기죠!', '땀 흘린 값은 받아야죠!'],
  },

  /* ---------------- 위기 ---------------- */
  lowhp: {
    knight: ['아직… 버틸 수 있어!', '이 정도로는 안 쓰러져!', '리라! 나 좀 봐줘!'],
    mage: ['…피가 좀 많이 샜네.', '거리를 벌려야겠어.', '치유, 지금.'],
    priest: ['제, 제가 먼저 쓰러지면 안 되는데…!', '조금만… 조금만 더 버틸게요!', '다들 물러서요, 위험해요!'],
    porter: ['짐보다 제가 먼저 깨지겠어요!', '이건 위험수당 청구감인데요!', '아이고, 살살 좀 때리시죠!'],
  },
  hurt: {
    knight: ['윽, 제법이잖아!', '이 정도는 긁힌 거야.', '아야! …아니, 안 아파!'],
    mage: ['…아파.', '맞을 자리는 아니었는데.', '계산 착오야.'],
    priest: ['아야…! 괘, 괜찮아요!', '너무 아파요…', '조금만 참으면 돼요…'],
    porter: ['살려줘…!', '제 밥값 돌려주세요!', '으악, 짐 무거운데 때리기까지!'],
  },
  down: {
    knight: ['미안… 여기서 끝은 아니야…', '먼저… 가 있어…', '분하다…!'],
    mage: ['…계산이, 틀렸나.', '여기까지인가…', '잠깐만… 쉴게…'],
    priest: ['죄송해요… 제가 부족해서…', '으윽… 미안해요…', '다들… 무사하셔야 해요…'],
    porter: ['제 짐… 누가 좀…', '아이고, 이렇게 억울할 데가…', '보험… 들어둘걸…'],
  },
  revive: {
    knight: ['좋았어, 다시 간다!', '한숨 잤더니 개운한데?', '기다렸지? 이제부터야!'],
    mage: ['…다시 계산할게.', '고마워. 빚은 갚을게.', '일어났어. 계속하자.'],
    priest: ['휴… 이제 괜찮을 거예요.', '자, 일어나세요. 제가 있잖아요.', '다행이에요… 정말 다행이에요.'],
    porter: ['살았다! 제 짐도 무사하죠?', '이야, 저승 문턱까지 갔다 왔네요!', '부활 수수료는 나중에 청구할게요!'],
  },
  unyielding: {
    knight: ['아직… 안 끝났어!', '한 대만 더 버티면 돼!', '여기서 무너질 순 없어!'],
    mage: ['…마지막 한 수는 남겨뒀어.', '아직 끝난 게 아니야.'],
    priest: ['제발… 모두 무사하기를…!', '아직… 쓰러질 순 없어요…!'],
    porter: ['빚 갚기 전엔 못 죽어요!', '아직 못 판 물건이 남았다고요!'],
  },
  dark: {
    knight: ['어둠이 짙어져… 서둘러야 해!', '앞이 안 보여! 불빛 쪽으로!', '이건 좀 위험한데…'],
    mage: ['광원 없이는 무리야. 지금.', '…어둠이 마력을 먹고 있어.', '시야가 0이야. 이동은 신중히.'],
    priest: ['어둠이… 숨을 조여와요!', '무서워요… 불빛이 필요해요!', '다들 제 곁에 붙어요, 제발!'],
    porter: ['어둠은 안 팔려요! 얼른 나가죠!', '이 어둠, 진짜 사람 잡겠는데요!', '등불! 등불 좀 켜주세요!'],
  },
  dark_down: {
    knight: ['어둠이… 삼킨다…'],
    mage: ['…빛이, 없어.'],
    priest: ['으윽… 어둠이…'],
    porter: ['안 보여요… 아무것도…'],
  },
  flare: {
    knight: ['플레어 간다! 눈 감아!', '불빛 확보! 이쪽으로!', '자, 이제 좀 보이지?'],
    mage: ['점화. 이 정도면 충분해.', '광원 확보. 계속 가자.'],
    priest: ['와아… 따뜻해요!', '빛이에요! 이제 괜찮아요!', '고마워요, 훨씬 나아졌어요!'],
    porter: ['플레어 한 발에 얼마더라…', '아까워라, 그래도 목숨값보단 싸죠!', '밝다! 이제 바닥에 뭐 떨어졌나 보이네!'],
  },
  trap: {
    knight: ['앗, 함정이야!', '윽! 발밑을 놓쳤네.', '조심해, 이 근처 함정투성이야!'],
    mage: ['…함정. 표시해둬.', '패턴이 있어. 다음은 안 밟아.'],
    priest: ['꺄악! 괘, 괜찮으세요?!', '피가 나요! 잠깐만요!'],
    porter: ['제 발! 제 소중한 발!', '함정 수리비 청구할 데가 없네요…'],
  },
  shrine: {
    knight: ['샘이다! 다들 마셔둬!', '몸이 가벼워졌어. 좋은데?'],
    mage: ['정화된 물이야. 마셔도 돼.', '…나쁘지 않네.'],
    priest: ['치유의 샘이에요! 다들 이리로!', '따뜻한 기운이 돌아요…!'],
    porter: ['공짜 회복! 이런 게 제일 좋죠!', '물 좀 담아갈까요? 팔릴 텐데.'],
  },
  shrine_cursed: {
    knight: ['속았다! 무기 들어!'],
    mage: ['이 물… 마력이 탁해. 함정이야.'],
    priest: ['이 샘… 뭔가 이상해요!'],
    porter: ['공짜엔 이유가 있다더니!'],
  },
  vein_ambush: {
    knight: ['무너진다! 다들 뭉쳐!'],
    mage: ['갱도 붕괴. 뒤에서 온다.'],
    priest: ['갱도가 무너져요! 조심해요!'],
    porter: ['제 광석! …아니, 제 목숨!'],
  },

  /* ---------------- 보상 ---------------- */
  treasure: {
    knight: ['좋았어, 이 맛에 내려오지!', '상자다! 열어보자!', '수확이 나쁘지 않은데?'],
    mage: ['…쓸 만한 게 들었네.', '수치상 이득이야.', '가져가자. 무게는 토토 담당.'],
    priest: ['우와, 반짝여요!', '조심히 열어요… 함정일 수도 있어요.', '좋은 게 나왔으면 좋겠어요!'],
    porter: ['오늘 벌이가 쏠쏠한데요?', '이야, 이건 값이 좀 나가겠는데요!', '제 계산기가 뜨거워지고 있어요!'],
  },
  unique: {
    knight: ['이건… 물건이야! 진짜 물건!', '이런 건 처음 봐. 내가 써도 될까?', '전설급이잖아! 운이 텄어!'],
    mage: ['…마력의 결이 달라. 진품이야.', '이건 값을 매길 수 없어.', '드물어. 아주 드물어.'],
    priest: ['어머, 이렇게 아름다운 게…!', '뭔가 따뜻한 힘이 느껴져요…', '이건 소중히 다뤄야 해요!'],
    porter: ['시, 시세를 모르겠는데요?!', '이건 안 팔아요! 절대 안 팔아요!', '제 인생 최고의 물건이에요…!'],
  },
  levelup: {
    knight: ['한 단계 더 강해졌어!', '몸이 가벼워! 더 갈 수 있어!', '성장 중이라고, 나!'],
    mage: ['마력 회로가 넓어졌어.', '…한 단계. 나쁘지 않아.'],
    priest: ['다들 더 잘 지켜드릴 수 있겠어요!', '기도가 닿았나 봐요!'],
    porter: ['짐을 더 들 수 있게 됐어요!', '레벨업 = 임금 인상, 맞죠?'],
  },
  mine_start: {
    knight: ['광맥이다! 내가 지킬 테니 캐!', '곡괭이 준비! 금방 끝내자!'],
    mage: ['아주라이트 반응. 순도는 나중에 보자.', '…캐는 동안은 무방비야. 경계해.'],
    priest: ['조심히 캐세요, 무너질 수도 있어요…', '주변은 제가 볼게요!'],
    porter: ['제가 제일 잘하는 일이죠!', '자자, 광부 토토 나갑니다!'],
  },
  mine_done: {
    knight: ['좋았어, 한 덩이 챙겼다!', '이 정도면 오늘치는 됐지?'],
    mage: ['회수 완료. 다음 광맥.', '…순도는 평균 이상이네.'],
    priest: ['무사히 캤어요! 다행이에요!', '반짝반짝… 예뻐요.'],
    porter: ['이야, 순도가 장난 아닌데요?', '아주라이트 시세가 요즘 좋거든요!', '이만하면 오늘 저녁은 고기입니다!'],
  },
  altar_win: {
    knight: ['운이 좋았어!', '봤지? 이런 건 배짱이야!'],
    mage: ['확률은 반이었어. 이긴 쪽이지.'],
    priest: ['다행이에요… 손이 다 떨렸어요.'],
    porter: ['이겼다! 제 골드가 두 배로!'],
  },
  altar_lose: {
    knight: ['젠장, 함정이었어!'],
    mage: ['도박은 원래 이래.'],
    priest: ['속았어요! 몬스터가…!'],
    porter: ['제 골드!! 돌려줘요!!'],
  },
  no_gold: {
    porter: ['지갑이 텅 비었는데요…', '외상은 안 된대요…', '골드 좀 벌고 다시 오죠!'],
  },
  heal: {
    priest: ['잠깐만요, 다친 곳부터 볼게요!', '금방 나을 거예요, 조금만요.', '무리하지 마세요, 제가 있잖아요!'],
  },

  /* ---------------- 발견 / 이동 ---------------- */
  stairs: {
    knight: ['계단 찾았어! 더 내려갈 수 있어!', '아래로 가는 길이다!', '좋아, 퇴로 확보!'],
    mage: ['하강로 확인.', '계단이야. 표시해뒀어.'],
    priest: ['계단이에요! 더 깊이… 가는 거죠?', '조금 무섭지만… 가요!'],
    porter: ['계단 발견! 깊을수록 비싸죠!', '아래층 시세가 더 좋다던데요!'],
  },
  merchant: {
    knight: ['상인이라니, 이런 데서?', '뭐 좋은 거 있나 보고 가자.'],
    mage: ['…이런 깊이에 장사꾼이라니.', '값만 맞으면 사자.'],
    priest: ['이런 곳에 사람이…! 괜찮으신 걸까요?', '따뜻한 거라도 파실까요?'],
    porter: ['상인이다! 뭐 좋은 거 없나요?', '흥정은 제게 맡기세요!', '지갑 열 준비 됐습니다!'],
  },
  enter: {
    knight: ['좋아, 들어간다. 다들 붙어!', '광산이라… 오랜만인데.'],
    mage: ['공기가 무거워. 조심해.', '…들어가면 되돌리기 어려워.'],
    priest: ['으스스해요…', '조심해서 가요!', '몬스터 냄새가 나요…'],
    porter: ['자, 오늘도 한몫 잡아봅시다!', '입구부터 돈 냄새가 나는데요!'],
  },
  path_boss: {
    knight: ['보스가 있는 갱도야… 조심하자!'],
    mage: ['강한 반응이야. 준비하고 가자.'],
    priest: ['공기가 무거워요… 큰 게 있어요.'],
    porter: ['보스방… 위험수당 두 배죠?'],
  },
  path_challenge: {
    knight: ['입구가 닫혔어! 싸워서 뚫는 수밖에!'],
    mage: ['봉쇄됐어. 전부 정리하면 열려.'],
    priest: ['문이… 닫혔어요! 어떡해요!'],
    porter: ['환불! 환불 좀 해주세요!'],
  },
  path_treasure: {
    knight: ['보물방이다! 단, 함정 조심해!'],
    mage: ['밀도가 높아. 함정도 같이.'],
    priest: ['반짝이는 게 잔뜩이에요… 조심해요!'],
    porter: ['보물이다! …함정도 잔뜩이지만요.'],
  },
  path_risk: {
    knight: ['험한 길이군. 그만큼 값어치는 하겠지!'],
    mage: ['기운이 심상치 않아요… 대신 벌이는 좋겠죠?'],
    priest: ['여긴… 정말 위험해 보여요.'],
    porter: ['고위험 고수익! 제가 좋아하는 말이죠!'],
  },
  biome_mine: {
    knight: ['갱도다. 발밑 조심해!', '버팀목이 삐걱거려… 서두르자.'],
    mage: ['목재가 삭았어. 붕괴 위험.', '광맥 반응이 강해.'],
    priest: ['광차 소리가… 아직도 들리는 것 같아요.', '어두워요… 등불 놓치지 마세요.'],
    porter: ['제 홈그라운드죠! 광맥은 제가 찾을게요!', '아주라이트 냄새가 진하네요!'],
  },
  biome_waterway: {
    knight: ['물길이야. 미끄러지지 마!', '물소리가 크군. 발소리가 묻히겠어.'],
    mage: ['수로야. 물속은 마법이 잘 퍼져.', '…습기가 많아. 불은 약해져.'],
    priest: ['물이 차가워요… 감기 걸리겠어요.', '물소리가 예뻐요. 조금은요.'],
    porter: ['짐 젖으면 값 떨어지는데!', '물길엔 가라앉은 보물이 있다던데요?'],
  },
  biome_lava: {
    knight: ['뜨겁다! 분출구 밟지 마!', '여긴 오래 못 있어. 빠르게 간다!'],
    mage: ['열원이 강해. 화염 마법은 증폭돼.', '…분출 주기를 세어둘게.'],
    priest: ['너무 뜨거워요… 다들 괜찮으세요?', '물, 물 좀 아껴 마셔요!'],
    porter: ['짐이 익겠어요!', '용암 옆 부동산은 싸다더니…'],
  },
  biome_cave: {
    knight: ['천연 동굴이군. 길이 복잡해!', '메아리가 심해. 소리에 속지 마.'],
    mage: ['지형이 불규칙해. 지도 믿지 마.', '…박쥐 냄새.'],
    priest: ['동굴이에요… 길 잃지 않게 붙어 있어요!', '어디선가 물 떨어지는 소리가 나요.'],
    porter: ['동굴 버섯! 이거 비싸게 팔려요!', '길 잃으면 제 짐부터 챙겨주세요!'],
  },
  biome_catacomb: {
    knight: ['묘지라… 기분 좋진 않군.', '죽은 것들이 움직이는 곳이야. 방심 금물!'],
    mage: ['사령 마력이 짙어. 해골이 많겠네.', '…뼈가 새것이야. 최근 거야.'],
    priest: ['가엾은 분들… 편히 쉬시길.', '기도라도 올리고 갈게요…'],
    porter: ['부장품! …아니, 예의는 갖출게요.', '묘지에서 장사하면 벌 받으려나…'],
  },

  /* ---------------- 유휴 잡담 ---------------- */
  idle_overworld: {
    knight: ['날씨 좋다! 훈련하기 딱인데.', '오늘은 어디까지 가볼까?', '초원 공기가 제일이야.', '다들 준비됐지?'],
    mage: ['…햇빛이 세네.', '책 읽기 좋은 날씨야.', '광산은 저쪽이야.', '바람 방향이 바뀌었어.'],
    priest: ['소풍 온 것 같아요~', '사과 주워가도 될까요?', '꽃이 예쁘게 폈어요!', '다들 다치지 않았으면 좋겠어요.'],
    porter: ['짐이 가벼우니 살 것 같네요!', '이 근처에 시장이 있으면 좋을 텐데.', '골드 세는 소리가 제일 좋아요~', '오늘 목표는 얼마로 할까요?'],
  },
  idle_dungeon: {
    knight: ['발밑 조심해.', '뭔가 소리가 들려… 붙어 있어.', '너무 벌어지지 마!', '내가 앞장선다.'],
    mage: ['…여기 마력이 고여 있어.', '벽에 긁힌 자국. 큰 놈이야.', '지도상으론 여기가 중간쯤.', '조용한 게 더 불안한데.'],
    priest: ['여긴 좀 어둡네요…', '다들 괜찮으신가요?', '조금만 더 가면 쉴 곳이 있을 거예요.', '무서워요… 손 잡아도 될까요?'],
    porter: ['보물 냄새가 나요!', '이쯤에서 한 번 쉬는 건 어떨까요?', '제 짐, 아직 자리 남았어요!', '오늘 벌이는 아직 부족한데요…'],
  },
};

/* =====================================================================
 * M3.5b — 성격군 공용 대사 풀 + 캐릭터 전용 대사
 * 기존 4인의 대사는 그대로 각 성격군의 공용 풀이 된다.
 *   유리 = 씩씩(brave) · 모리 = 시크(cool) · 리라 = 다정(kind) · 토토 = 너스레(joker)
 * 신규 캐릭터는 "성격군 공용 풀 + 자기 전용 3줄 이상"을 쓴다.
 * DIALOGUE 자체는 건드리지 않는다 — 기존 테이블/개수 검증이 그대로 통과한다.
 * =================================================================== */
const PERSONA_SRC = { brave: 'knight', cool: 'mage', kind: 'priest', joker: 'porter' };
// 다른 캐릭터의 이름을 부르는 대사는 공용 풀에서 뺀다 (파티에 없을 수 있다)
const NAME_WORDS = ['유리', '모리', '리라', '토토'];
const PERSONA_DIALOGUE = {};
Object.keys(DIALOGUE).forEach(ev => {
  const row = {};
  PERSONA_KEYS.forEach(pk => {
    const src = DIALOGUE[ev][PERSONA_SRC[pk]];
    if (!src || !src.length) return;
    const arr = src.filter(t => !NAME_WORDS.some(w => t.indexOf(w) >= 0));
    if (arr.length) row[pk] = arr;
  });
  if (Object.keys(row).length) PERSONA_DIALOGUE[ev] = row;
});

/* 캐릭터 전용 대사 — 신규 18인은 각 3줄 이상 */
const CHAR_LINES = {
  necro:   { combat: ['일어나라. 오늘도 일할 시간이야.'], idle_dungeon: ['해골은 불평이 없어서 좋아.'], levelup: ['소환진이 한 겹 더 두꺼워졌네.'] },
  bomber:  { combat: ['자, 불꽃놀이 시작합니다!'], idle_dungeon: ['심지 길이는 항상 여유 있게.'], levelup: ['화약 배합을 조금 바꿔볼까요?'] },
  blade:   { combat: ['멈추지 마. 멈추면 베여.'], idle_dungeon: ['칼날이 무뎌지면 그때가 끝이야.'], levelup: ['회전이 한 바퀴 더 늘었어.'] },
  spear:   { combat: ['한 줄로 서! 한 번에 끝낸다!'], idle_dungeon: ['창은 거리가 생명이지!'], levelup: ['찌르기가 한 뼘 더 뻗는다!'] },
  berserk: { combat: ['피 냄새… 좋군.'], idle_dungeon: ['상처는 훈장이야.'], levelup: ['더 아프게 맞을 수 있게 됐군.'] },
  paladin: { combat: ['제 뒤로 오세요. 막아드릴게요.'], idle_dungeon: ['모두 무사한지 한 번만 더 볼게요.'], levelup: ['방패가 더 넓어졌어요.'] },
  monk:    { combat: ['한 대? 두 대는 쳐야지!'], idle_dungeon: ['숨 고르기, 하나 둘 셋!'], levelup: ['주먹이 가벼워졌는데!'] },
  axe:     { combat: ['크게 한 방, 갑니다!'], idle_dungeon: ['도끼날 값도 만만치 않다고요.'], levelup: ['이제 두 번 안 휘둘러도 되겠네.'] },
  archer:  { combat: ['숨 참고… 놓는다.'], idle_dungeon: ['화살은 세어뒀어. 낭비는 없어.'], levelup: ['시위가 더 팽팽해졌군.'] },
  pyro:    { combat: ['다 태워버릴게!'], idle_dungeon: ['불씨는 꺼뜨리면 안 돼!'], levelup: ['화력이 올랐어! 신난다!'] },
  cryo:    { combat: ['얼어붙어.'], idle_dungeon: ['…여기 좀 춥지 않아? 내 탓인가.'], levelup: ['빙점이 더 내려갔네.'] },
  spirit:  { combat: ['얘야, 부탁할게!'], idle_dungeon: ['정령이 자꾸 앞서 나가요…'], levelup: ['정령이 좋아하는 것 같아요.'] },
  bard:    { combat: ['자, 전투곡 1번!'], idle_dungeon: ['발맞춰서! 하나 둘 하나 둘!'], levelup: ['음역대가 넓어졌어!'] },
  shrine:  { combat: ['부적, 하나씩 받으세요.'], idle_dungeon: ['이 갱도… 기운이 탁하네요.'], levelup: ['결계가 더 단단해졌어요.'] },
  alchem:  { combat: ['자, 실험 대상 등장!'], idle_dungeon: ['약값은 나중에 정산할게요, 나중에!'], levelup: ['배합비를 다시 계산해야겠는데요?'] },
  chrono:  { combat: ['너희 시간만 느리게 갈 거야.'], idle_dungeon: ['1분 뒤가 이미 보이는데.'], levelup: ['지연장이 넓어졌어.'] },
  druid:   { combat: ['조금… 커지겠습니다.'], idle_dungeon: ['이 아래에도 뿌리가 있네요.'], levelup: ['털이 더 두꺼워진 것 같아요.'] },
  hunter:  { combat: ['물어! …아, 착하지.'], idle_dungeon: ['얘가 저보다 먼저 눈치채요.'], levelup: ['늑대가 더 빨라졌어!'] },
};
function charLineCount(id) {
  const t = CHAR_LINES[id];
  if (!t) return 0;
  let n = 0;
  for (const ev in t) n += t[ev].length;
  return n;
}

/* ---- 런타임 상태 (저장하지 않는다) ---- */
const SAY_HIST_MAX = 8;     // 캐릭터별로 기억하는 최근 발화 수
const SAY_EVENT_CD = 10;    // 같은 이벤트 재발화 금지(초)
const SAY_IDLE_BLOCK = 4;   // 이벤트 대사 직후 이 시간(초) 동안은 잡담을 미룬다
const sayHistory = {};      // 캐릭터 id → 최근 발화 배열
const sayEventAt = {};      // 이벤트 키 → 마지막 발화 시각
let sayLastEventAt = -99;   // 잡담을 제외한 마지막 이벤트 대사 시각
const biomeSeen = {};       // 바이옴 키 → 첫 진입 대사를 이미 했는지

function isIdleEvent(ev) { return ev === 'idle_overworld' || ev === 'idle_dungeon'; }
/* 이벤트 × 캐릭터 대사 풀 (없으면 null) */
function dialogueLines(ev, id) {
  const pool = DIALOGUE[ev];
  if (!pool) return null;
  const arr = pool[id];
  if (arr && arr.length) return arr;              // 기존 4인은 전용 테이블 그대로
  // 신규 캐릭터: 전용 대사 + 성격군 공용 풀
  const own = (CHAR_LINES[id] && CHAR_LINES[id][ev]) || null;
  const per = PERSONA_DIALOGUE[ev] && PERSONA_DIALOGUE[ev][(ROSTER_BY_ID[id] || {}).persona];
  if (!own && !per) return null;
  const out = (own || []).concat(per || []);
  return out.length ? out : null;
}
/* 그 이벤트에서 말할 수 있는 캐릭터 id 목록 */
function dialogueChars(ev) {
  const pool = DIALOGUE[ev];
  return pool ? Object.keys(pool) : [];
}
function dialogueLineCount() {
  let n = 0;
  for (const ev in DIALOGUE) for (const id in DIALOGUE[ev]) n += DIALOGUE[ev][id].length;
  return n;
}
/* 최근 발화 8개를 제외하고 추첨.
 * 그 풀이 전부 소진되면 '그 풀의 대사만' 기억에서 지운다 — 다른 이벤트의 기억은
 * 그대로 남으므로 캐릭터의 최근 8개 기억이 한 이벤트 때문에 통째로 날아가지 않는다.
 * 리셋 직후에는 방금 한 말만 후보에서 빼 같은 대사가 연달아 나오는 것을 막는다. */
function pickLine(ev, id) {
  const lines = dialogueLines(ev, id);
  if (!lines) return null;
  const hist = sayHistory[id] || (sayHistory[id] = []);
  let cand = lines.filter(t => hist.indexOf(t) < 0);
  if (!cand.length) {
    const last = hist[hist.length - 1];
    for (let i = hist.length - 1; i >= 0; i--) if (lines.indexOf(hist[i]) >= 0) hist.splice(i, 1);
    cand = lines.filter(t => t !== last);
    if (!cand.length) cand = lines.slice();
  }
  const txt = pick(cand);
  hist.push(txt);
  while (hist.length > SAY_HIST_MAX) hist.shift();
  return txt;
}
function sayHistoryOf(id) { return (sayHistory[id] || []).slice(); }
/* 쿨다운이 풀렸는지 (잡담은 쿨다운 없음 — 잡담 타이머가 빈도를 관리한다) */
function sayEventReady(ev) {
  if (isIdleEvent(ev)) return true;
  const last = sayEventAt[ev];
  return last === undefined || (state.time - last) >= SAY_EVENT_CD;
}
/* 상황 대사 발화.
 *   ev   이벤트 키
 *   who  화자(생략하면 그 이벤트를 말할 수 있는 생존 멤버 중 추첨)
 *   opt  { force: 쿨다운 무시, allowDown: 쓰러진 멤버도 말함, life: 말풍선 유지 시간 } */
function sayEvent(ev, who, opt) {
  opt = opt || {};
  if (!DIALOGUE[ev]) return null;
  if (!opt.force && !sayEventReady(ev)) return null;
  let m = who || null;
  if (m && !dialogueLines(ev, m.id)) m = null;
  if (m && m.down && !opt.allowDown) m = null;
  if (!m) {
    const pool = (opt.allowDown ? party : aliveMembers()).filter(a => dialogueLines(ev, a.id));
    if (!pool.length) return null;
    m = pick(pool);
  }
  const txt = pickLine(ev, m.id);
  if (!txt) return null;
  sayEventAt[ev] = state.time;
  if (!isIdleEvent(ev)) sayLastEventAt = state.time;
  say(m, txt, opt.life);
  return { ev, who: m, txt };
}
/* 보스 조우 — 보스 전용 풀이 있으면 그쪽을 먼저 쓴다 */
function sayBoss(mon) {
  if (!mon) return null;
  const key = 'boss_' + mon.type;
  return (DIALOGUE[key] && sayEvent(key, null, { force: true })) || sayEvent('boss');
}
/* 바이옴 첫 진입 (런타임 기억 — 세이브하지 않는다) */
function sayBiomeEntry(biome) {
  if (!biome || biomeSeen[biome]) return null;
  const key = 'biome_' + biome;
  if (!DIALOGUE[key]) { biomeSeen[biome] = true; return null; }
  biomeSeen[biome] = true;
  return sayEvent(key, null, { force: true });
}
/* 유휴 잡담 — 이벤트 대사가 방금 나왔으면 한 박자 미룬다 */
function sayIdle() {
  if (state.time - sayLastEventAt < SAY_IDLE_BLOCK) return null;
  const mode = (state.world && state.world.mode === 'dungeon') ? 'dungeon' : 'overworld';
  return sayEvent('idle_' + mode);
}
/* 계단 / 상인 발견 — reveal() 에서 매번 불리므로 플래그로 즉시 빠져나간다 */
function noticeDiscoveries(wld) {
  if (!wld || wld.mode !== 'dungeon' || !wld.seen) return;
  if (!wld.__sawStairs) {
    const s = wld.stairs;
    if (s && wld.seen[s.y * wld.w + s.x]) { wld.__sawStairs = true; sayEvent('stairs'); }
  }
  if (wld.__sawMerchant === undefined) {
    wld.__sawMerchant = !wld.props.some(p => p.type === 'merchant');
  }
  if (!wld.__sawMerchant) {
    const p = wld.props.find(o => o.type === 'merchant' && wld.seen[o.gy * wld.w + o.gx]);
    if (p) { wld.__sawMerchant = true; sayEvent('merchant', party[3]); }
  }
}
/* 테스트/새 런용 초기화 */
function resetDialogue(keepBiome) {
  for (const k in sayHistory) delete sayHistory[k];
  for (const k in sayEventAt) delete sayEventAt[k];
  sayLastEventAt = -99;
  if (!keepBiome) for (const k in biomeSeen) delete biomeSeen[k];
}

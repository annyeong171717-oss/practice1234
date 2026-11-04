// Curated, officially released K-pop tracks. Only metadata lives here;
// the original lyrics are fetched at runtime from the lyrics API.
export const CATALOG = {
  'ko-en': [
    { title: '밤편지', artist: 'IU', year: 2017, mood: '서정 · 발라드', search: { track: '밤편지', artist: 'IU' } },
    { title: '봄날', artist: 'BTS', year: 2017, mood: '그리움', search: { track: '봄날', artist: 'BTS' } },
    { title: 'Ditto', artist: 'NewJeans', year: 2022, mood: '아련함', search: { track: 'Ditto', artist: 'NewJeans' } },
    { title: 'LOVE DIVE', artist: 'IVE', year: 2022, mood: '당당함', search: { track: 'LOVE DIVE', artist: 'IVE' } },
    { title: 'Supernova', artist: 'aespa', year: 2024, mood: '강렬함', search: { track: 'Supernova', artist: 'aespa' } },
    { title: 'ANTIFRAGILE', artist: 'LE SSERAFIM', year: 2022, mood: '자신감', search: { track: 'ANTIFRAGILE', artist: 'LE SSERAFIM' } },
    { title: '어떻게 이별까지 사랑하겠어, 널 사랑하는 거지', artist: 'AKMU', year: 2019, mood: '이별', search: { track: '어떻게 이별까지 사랑하겠어, 널 사랑하는 거지', artist: 'AKMU' } },
    { title: '한 페이지가 될 수 있게', artist: 'DAY6', year: 2019, mood: '청춘', search: { track: '한 페이지가 될 수 있게', artist: 'DAY6' } },
    { title: '좋은 날', artist: 'IU', year: 2010, mood: '설렘', search: { track: '좋은 날', artist: 'IU' } },
    { title: '아주 NICE', artist: 'SEVENTEEN', year: 2016, mood: '신남', search: { track: '아주 NICE', artist: 'SEVENTEEN' } },
    { title: '봄여름가을겨울 (Still Life)', artist: 'BIGBANG', year: 2022, mood: '회고', search: { track: 'Still Life', artist: 'BIGBANG' } },
    { title: 'Love wins all', artist: 'IU', year: 2024, mood: '위로', search: { track: 'Love wins all', artist: 'IU' } },
  ],
  'en-ko': [
    { title: 'Dynamite', artist: 'BTS', year: 2020, mood: '디스코 팝', search: { track: 'Dynamite', artist: 'BTS' } },
    { title: 'Butter', artist: 'BTS', year: 2021, mood: '자신감', search: { track: 'Butter', artist: 'BTS' } },
    { title: 'Permission to Dance', artist: 'BTS', year: 2021, mood: '희망', search: { track: 'Permission to Dance', artist: 'BTS' } },
    { title: 'Seven', artist: 'Jung Kook', year: 2023, mood: '로맨스', search: { track: 'Seven', artist: 'Jung Kook' } },
    { title: 'The Feels', artist: 'TWICE', year: 2021, mood: '설렘', search: { track: 'The Feels', artist: 'TWICE' } },
    { title: 'Perfect Night', artist: 'LE SSERAFIM', year: 2023, mood: '우정', search: { track: 'Perfect Night', artist: 'LE SSERAFIM' } },
    { title: 'APT.', artist: 'ROSÉ & Bruno Mars', year: 2024, mood: '파티', search: { track: 'APT.', artist: 'ROSÉ' } },
    { title: 'Lose My Breath', artist: 'Stray Kids', year: 2024, mood: '열정', search: { track: 'Lose My Breath', artist: 'Stray Kids' } },
  ],
};

// Quick-access chips; any other artist is reachable through search.
export const POPULAR_ARTISTS = [
  'BTS', 'BLACKPINK', 'NewJeans', 'IVE', 'aespa', 'LE SSERAFIM', 'SEVENTEEN', 'Stray Kids', 'TWICE', 'IU',
  'i-dle', 'ILLIT', 'BABYMONSTER', 'RIIZE', 'ZEROBASEONE', 'TOMORROW X TOGETHER', 'ENHYPEN', 'NCT 127', 'NCT DREAM', 'EXO',
  'Red Velvet', 'ITZY', 'NMIXX', 'KISS OF LIFE', 'BOYNEXTDOOR', 'TWS', 'DAY6', 'AKMU', 'BIGBANG', 'G-DRAGON',
  'TAEYEON', "Girls' Generation", 'SHINee', 'MAMAMOO', 'Jung Kook', 'JIMIN', 'ROSÉ', 'JENNIE', 'LISA', 'QWER',
];

export const TIPS = [
  '번안은 단어 바꾸기가 아니라 감정 옮기기예요. 원곡이 주는 "느낌"부터 한 단어로 적어 보세요.',
  '영어 가사는 동사로 시작하면 리듬이 살아요. "I am running" 보다 "Running to you"!',
  '음절 수가 원곡과 비슷하면 멜로디에 얹기 쉬워요. 스튜디오의 음절 미터를 활용해 보세요.',
  '줄 끝 단어끼리 라임을 맞추면 훨씬 노래 같아져요: night / light / tonight.',
  '한국어의 주어 생략, 영어에서는 대부분 I / you를 살려야 자연스러워요.',
  '관사 a/the 고민될 땐: 처음 등장하면 a, 서로 아는 대상이면 the!',
  '"너무 좋아"를 늘 "so good"으로 쓰지 말고 "can\'t get enough"처럼 표현을 바꿔 보세요.',
];
